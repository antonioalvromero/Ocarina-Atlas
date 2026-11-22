'use strict'

const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron')
const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')

const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_PORT = 3000
const DEFAULT_LICHII_HOST = '127.0.0.1'
const DEFAULT_LICHII_PORT = 6545
const MAX_LOG_LINES = 500

const OFFICIAL_REPO_URL = 'https://github.com/antonioalvromero/Ocarina-Atlas'
const OFFICIAL_RELEASES_API_URL =
  'https://api.github.com/repos/antonioalvromero/Ocarina-Atlas/releases/latest'
const LINUX_APPIMAGE_ASSET_NAME = 'OcarinaAtlas-Linux-x64.AppImage'
const LINUX_APPIMAGE_SHA256_ASSET_NAME = 'OcarinaAtlas-Linux-x64.AppImage.sha256'
const ALLOWED_GITHUB_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com',
])

const RECOMP_PROCESS_NAMES = new Set([
  'hookshot',
  'longshot',
  'heylisten',
  'relink-game',
  'relink',
  'triforce',
  'ocarina',
  'nx2navi',
])

const DIRECT_HOST_VA_PROCESS_NAMES = new Set(['ocarina', 'nx2navi'])

// NX2Saria serves the debug RPC on 127.0.0.1:6545 itself, so only its save folder is detected
const NX2SARIA_PROCESS_NAMES = new Set(['ocarina', 'nx2saria'])

const EMULATOR_PROCESS_NAMES = new Set([
  'lichii',
  'fritchii',
  'cheezyemu',
  'eden',
  'ocarina',
  'nx2saria',
])

const RUNTIME_DISPLAY_NAMES = {
  lichii: 'Lichii',
  fritchii: 'Fritchii',
  cheezyemu: 'CheezyEmu',
  eden: 'Eden',
  ocarina: 'NX2Saria',
  nx2saria: 'NX2Saria',
  ootpc: 'OOT-PC',
  nx2navi: 'OOT-PC',
  hookshot: 'Hookshot',
  longshot: 'Longshot',
  heylisten: 'HeyListen',
  'relink-game': 'Project ReLink',
  relink: 'Project ReLink',
  triforce: 'Triforce',
}

const VIRTUAL_ADAPTER_PATTERN =
  /(?:vethernet|hyper-v|wsl|virtualbox|vbox|vmware|docker|veth|utun|wintun|tailscale|zerotier|wireguard|nordlynx|radmin|hamachi|openvpn|bluetooth|loopback|npcap|isatap|teredo|\btap(?:[\s_-]?\d+|\b)|\btun(?:[\s_-]?\d+|\b))/i

const WINDOW_WIDTH = 556
const WINDOW_HEIGHT_COMPACT = 480
const WINDOW_HEIGHT_EXPANDED = 820

function parsePort(raw, fallback, allowZero = false) {
  const trimmed = String(raw ?? '').trim()
  if (!/^\d+$/.test(trimmed)) return fallback
  const n = Number.parseInt(trimmed, 10)
  const min = allowZero ? 0 : 1
  return Number.isInteger(n) && n >= min && n <= 65535 ? n : fallback
}

function getCliArgs() {
  const raw = process.argv
  if (process.defaultApp) {
    return raw.slice(2)
  }
  return raw.slice(1)
}

function parseArgs(argv, env = process.env) {
  const opts = {
    host: env.HOST?.trim() || DEFAULT_HOST,
    port: parsePort(env.PORT, DEFAULT_PORT, true),
    lichiiHost: env.LICHII_HOST?.trim() || env.FRITCHII_HOST?.trim() || DEFAULT_LICHII_HOST,
    lichiiPort: parsePort(env.LICHII_PORT || env.FRITCHII_PORT, DEFAULT_LICHII_PORT, false),
    saveDir: env.CUSTOM_SAVE_DIR?.trim() || '',
    saveSlot: env.CUSTOM_SAVE_SLOT?.trim() || '',
    noBrowser: false,
    cli: false,
    lanExplicit: false,
    setupSync: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    if (!arg) continue
    const eqIdx = arg.indexOf('=')
    const key = eqIdx > 0 ? arg.slice(0, eqIdx) : arg
    const inlineVal = eqIdx > 0 ? arg.slice(eqIdx + 1) : undefined

    if (key === '--help' || key === '-h') {
      opts.help = true
    } else if (key === '--lan') {
      opts.host = DEFAULT_HOST
      opts.lanExplicit = true
    } else if (key === '--local-only' || key === '--localhost') {
      opts.host = '127.0.0.1'
      opts.lanExplicit = true
    } else if (key === '--no-browser') {
      opts.noBrowser = true
    } else if (key === '--cli' || key === '--no-gui') {
      opts.cli = true
    } else if (key === '--setup-sync') {
      opts.setupSync = true
    } else if (key === '--port') {
      const val = inlineVal ?? argv[++i]
      if (val === undefined) throw new Error('--port requires a value')
      const parsed = parsePort(val, -1, true)
      if (parsed < 0) throw new Error(`Invalid --port value: ${val}`)
      opts.port = parsed
    } else if (key === '--host') {
      const val = inlineVal ?? argv[++i]
      if (!val || !val.trim()) throw new Error('--host requires a value')
      opts.host = val.trim()
      opts.lanExplicit = true
    } else if (key === '--lichii-host') {
      const val = inlineVal ?? argv[++i]
      if (!val || !val.trim()) throw new Error('--lichii-host requires a value')
      opts.lichiiHost = val.trim()
    } else if (key === '--lichii-port') {
      const val = inlineVal ?? argv[++i]
      if (val === undefined) throw new Error('--lichii-port requires a value')
      const parsed = parsePort(val, -1, false)
      if (parsed < 1) throw new Error(`Invalid --lichii-port value: ${val}`)
      opts.lichiiPort = parsed
    } else if (key === '--save-dir') {
      const val = inlineVal ?? argv[++i]
      if (!val || !val.trim()) throw new Error('--save-dir requires a value')
      opts.saveDir = val.trim()
    } else if (key === '--save-slot') {
      const val = inlineVal ?? argv[++i]
      if (!val || !val.trim()) throw new Error('--save-slot requires a value')
      opts.saveSlot = val.trim()
    }
    // Ignore Electron/Chromium internal flags (e.g. --no-sandbox, --ozone-platform=...)
  }

  return opts
}

function printHelp() {
  console.log(`Ocarina Atlas — Linux x64 Launcher (${OFFICIAL_REPO_URL})

Usage: OcarinaAtlas [options]

Options:
  --port <n>          HTTP port for the map server (default: ${DEFAULT_PORT})
  --host <addr>       Bind address (default: ${DEFAULT_HOST})
  --lan               Bind all interfaces (${DEFAULT_HOST}) for phone/tablet access
  --local-only        Bind loopback only (127.0.0.1)
  --lichii-host <h>   Emulator/Lichii debug RPC host (default: ${DEFAULT_LICHII_HOST})
  --lichii-port <p>   Emulator/Lichii debug RPC port (default: ${DEFAULT_LICHII_PORT})
  --save-dir <path>   Custom save folder path (overrides auto-detection)
  --save-slot <slot>  Preferred save slot (e.g. slot_00)
  --no-browser        Run headlessly without opening GUI window or browser
  --cli               Alias for headless CLI mode
  --setup-sync        Write EDEN_NX2_DEBUG_SERVER=<host>:<port> to
                      ~/.config/{lichii,fritchii,eden,cheezyemu}/nx2_switches.txt and
                      ~/.local/share/{lichii,fritchii,eden,cheezyemu}/nx2_switches.txt and exit
  --help, -h          Show this help message`)
}

function isLoopbackHost(host) {
  const normalized = String(host ?? '').trim().toLowerCase()
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

function isWildcardBindHost(host) {
  const normalized = String(host ?? '').trim().toLowerCase()
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '0:0:0:0:0:0:0:0'
}

function collectLanUrls(port) {
  const urls = []
  const seen = new Set()
  const ifaces = os.networkInterfaces()
  for (const [name, entries] of Object.entries(ifaces)) {
    if (!entries || VIRTUAL_ADAPTER_PATTERN.test(name)) continue
    for (const entry of entries) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4
      if (!isIpv4 || entry.internal) continue
      const addr = entry.address.trim()
      if (!addr || addr.startsWith('127.') || addr.startsWith('169.254.') || addr === '0.0.0.0') {
        continue
      }
      const url = `http://${addr}:${port}`
      if (!seen.has(url)) {
        seen.add(url)
        urls.push({ url, interfaceName: name })
      }
    }
  }
  return urls
}

function probeTcpPort(host, port, timeoutMs = 200) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (open) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

function updateNx2SwitchFile(configPath, newLine) {
  const activeSwitchRe = /^\s*EDEN_NX2_DEBUG_SERVER\s*=\s*(.+?)\s*$/
  const outLines = []

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8')
    const existingLines = raw.split(/\r?\n/)
    let replaced = false
    for (const line of existingLines) {
      const trimmed = line.trimStart()
      if (!trimmed.startsWith('#') && activeSwitchRe.test(line)) {
        if (!replaced) {
          outLines.push(newLine)
          replaced = true
        }
        continue
      }
      outLines.push(line)
    }
    if (!replaced) {
      if (outLines.length > 0 && outLines[outLines.length - 1] === '') {
        outLines.pop()
      }
      outLines.push(newLine)
    }
  } else {
    outLines.push('# Emulator NX2 switches (configured by Ocarina Atlas)')
    outLines.push('# Restart Lichii / Fritchii / CheezyEmu after editing.')
    outLines.push(newLine)
  }

  let content = outLines.join('\n')
  if (!content.endsWith('\n')) {
    content += '\n'
  }
  fs.writeFileSync(configPath, content, 'utf8')
}

const SYNC_PROFILE_NAMES = ['lichii', 'fritchii', 'eden', 'cheezyemu']
const SYNC_PROCESS_NAMES = new Set(SYNC_PROFILE_NAMES)
const MANDATORY_CONFIG_PROFILES = new Set(['lichii', 'fritchii'])

function normalizePossibleWinePath(rawPath) {
  if (typeof rawPath !== 'string') return ''
  const trimmed = rawPath.trim()
  if (!trimmed) return ''
  if (/^[zZ]:[\\/]/.test(trimmed)) {
    return trimmed.slice(2).replace(/\\/g, '/')
  }
  return trimmed
}

function readCmdlineTokens(pid) {
  try {
    const rawCmd = fs.readFileSync(`/proc/${pid}/cmdline`)
    return rawCmd
      .toString('utf8')
      .split('\0')
      .map((t) => t.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function setupSync(lichiiHost = DEFAULT_LICHII_HOST, lichiiPort = DEFAULT_LICHII_PORT) {
  const home = os.homedir()
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config')
  const dataHome = process.env.XDG_DATA_HOME?.trim() || path.join(home, '.local', 'share')
  const target = `${lichiiHost}:${lichiiPort}`
  const newLine = `EDEN_NX2_DEBUG_SERVER=${target}`

  const candidates = []
  const candidateSet = new Set()
  const addCandidate = (cfgPath) => {
    if (!cfgPath || candidateSet.has(cfgPath)) return
    candidateSet.add(cfgPath)
    candidates.push(cfgPath)
  }

  for (const name of SYNC_PROFILE_NAMES) {
    addCandidate(path.join(configHome, name, 'nx2_switches.txt'))
  }
  for (const name of SYNC_PROFILE_NAMES) {
    addCandidate(path.join(dataHome, name, 'nx2_switches.txt'))
  }

  const forcedTargets = new Set([
    path.join(configHome, 'lichii', 'nx2_switches.txt'),
    path.join(configHome, 'fritchii', 'nx2_switches.txt'),
  ])

  if (process.platform === 'linux' && fs.existsSync('/proc')) {
    try {
      const entries = fs.readdirSync('/proc', { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
        const pid = Number.parseInt(entry.name, 10)
        if (pid === process.pid) continue

        let matchedName = null
        try {
          const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8')
          matchedName = normalizeProcessName(comm, SYNC_PROCESS_NAMES, true)
        } catch {
          // Ignore
        }

        const cmdTokens = readCmdlineTokens(pid)
        let wineExeToken = ''
        for (const tok of cmdTokens) {
          if (tok.startsWith('-')) continue
          const candidate = normalizeProcessName(tok, SYNC_PROCESS_NAMES, false)
          if (candidate) {
            if (!matchedName) matchedName = candidate
            if (/^[zZ]:[\\/]/.test(tok)) wineExeToken = tok
            break
          }
        }

        let exePath = ''
        try {
          exePath = fs.readlinkSync(`/proc/${pid}/exe`)
          if (!matchedName) {
            matchedName = normalizeProcessName(exePath, SYNC_PROCESS_NAMES, false)
          }
        } catch {
          // Ignore
        }

        if (!matchedName) continue

        const exeDirs = []
        if (exePath) exeDirs.push(path.dirname(exePath))
        if (wineExeToken) exeDirs.push(path.dirname(normalizePossibleWinePath(wineExeToken)))

        for (const exeDir of exeDirs) {
          if (!exeDir) continue
          const directSwitchPath = path.join(exeDir, 'nx2_switches.txt')
          const portableUserDir = path.join(exeDir, 'user')
          if (fs.existsSync(directSwitchPath) || fs.existsSync(portableUserDir)) {
            addCandidate(directSwitchPath)
            forcedTargets.add(directSwitchPath)
            if (fs.existsSync(portableUserDir)) {
              const userSwitchPath = path.join(portableUserDir, 'nx2_switches.txt')
              addCandidate(userSwitchPath)
              forcedTargets.add(userSwitchPath)
            }
          }
        }
      }
    } catch {
      // Ignore /proc scan errors
    }
  }

  const updated = []
  for (const cfgPath of candidates) {
    const profileDir = path.dirname(cfgPath)
    const profileName = path.basename(profileDir).toLowerCase()
    const shouldCreateDir =
      forcedTargets.has(cfgPath) ||
      (path.dirname(profileDir) === configHome && MANDATORY_CONFIG_PROFILES.has(profileName))
    try {
      if (shouldCreateDir && !fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true })
      }
      if (fs.existsSync(profileDir)) {
        updateNx2SwitchFile(cfgPath, newLine)
        updated.push(cfgPath)
      }
    } catch {
      // Ignore unwritable candidate paths
    }
  }

  return { updated, checked: candidates, line: newLine, target }
}

function normalizeProcessName(rawName, allowedSet, isComm = false) {
  if (!rawName) return null
  const trimmed = String(rawName).trim()
  if (!trimmed) return null
  const base = trimmed.split(/[\\/]/).pop() ?? ''
  if (!base) return null

  let normalized = base.toLowerCase()
  while (/\.(exe|appimage|x86_64)$/i.test(normalized)) {
    normalized = normalized.replace(/\.(exe|appimage|x86_64)$/i, '')
  }
  if (allowedSet.has(normalized)) {
    return normalized
  }

  // Linux /proc/<pid>/comm truncates process names at 15 chars (e.g. "heylisten.appim", "relink-game.x86")
  if (isComm && base.length >= 15) {
    const dotIdx = normalized.indexOf('.')
    if (dotIdx > 0) {
      const prefix = normalized.slice(0, dotIdx)
      if (allowedSet.has(prefix)) {
        return prefix
      }
    }
  }
  return null
}

function resolveLongshotSaveDir() {
  const home = os.homedir()
  const dataHome = process.env.XDG_DATA_HOME?.trim() || path.join(home, '.local', 'share')
  const xdgLongshot = path.join(dataHome, 'longshot')
  const xdgLongshotUser = path.join(xdgLongshot, 'user')

  if (fs.existsSync(path.join(xdgLongshotUser, 'save'))) {
    return xdgLongshotUser
  }
  if (fs.existsSync(path.join(xdgLongshot, 'save'))) {
    return xdgLongshot
  }

  const gamesLongshotUser = path.join(home, 'Games', 'Longshot', 'user')
  if (fs.existsSync(path.join(gamesLongshotUser, 'save'))) {
    return gamesLongshotUser
  }
  if (fs.existsSync(xdgLongshotUser)) {
    return xdgLongshotUser
  }
  if (fs.existsSync(xdgLongshot)) {
    return xdgLongshot
  }
  if (fs.existsSync(gamesLongshotUser)) {
    return gamesLongshotUser
  }
  return null
}

function resolveUserSaveDirFromExe(exePath) {
  if (!exePath) return null
  const normalizedExe = normalizePossibleWinePath(exePath)
  if (!normalizedExe) return null
  const exeDir = path.dirname(normalizedExe)
  const leaf = path.basename(exeDir).toLowerCase()
  const gameRoot = leaf === 'bin' ? path.dirname(exeDir) : exeDir
  if (!gameRoot) return null

  const userDir = path.join(gameRoot, 'user')
  if (fs.existsSync(path.join(userDir, 'save'))) {
    return userDir
  }

  let parentDir = gameRoot
  for (let depth = 0; depth < 3; depth += 1) {
    const nextParent = path.dirname(parentDir)
    if (!nextParent || nextParent === parentDir) break
    parentDir = nextParent

    const portableUser = path.join(parentDir, 'LongshotLauncher-data', 'user')
    if (fs.existsSync(portableUser)) {
      return portableUser
    }
    if (path.basename(parentDir).toLowerCase() === 'longshotlauncher-data') {
      const directPortableUser = path.join(parentDir, 'user')
      if (fs.existsSync(directPortableUser)) {
        return directPortableUser
      }
    }
  }

  const xdgDir = resolveLongshotSaveDir()
  if (xdgDir) {
    return xdgDir
  }

  return fs.existsSync(userDir) ? userDir : null
}

function readYamaPtraceScope() {
  try {
    const raw = fs.readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'utf8').trim()
    if (!/^\d+$/.test(raw)) return null
    return Number.parseInt(raw, 10)
  } catch {
    return null
  }
}

let bridgeLogSink = null
let lastPtraceProbeWarnPid = 0
let lastPtraceProbeWarnAt = 0

function warnPtraceProbeBlocked(pid, procName, errCode) {
  const now = Date.now()
  if (pid === lastPtraceProbeWarnPid && now - lastPtraceProbeWarnAt < 30000) {
    return
  }
  lastPtraceProbeWarnPid = pid
  lastPtraceProbeWarnAt = now
  const ptraceScope = readYamaPtraceScope()
  const scopeSuffix = ptraceScope !== null ? ` (kernel.yama.ptrace_scope=${ptraceScope})` : ''
  const msg = `[bridge] Cannot read /proc/${pid}/mem for ${procName} (${errCode})${scopeSuffix}. Check kernel.yama.ptrace_scope (e.g. sudo sysctl -w kernel.yama.ptrace_scope=0).`
  if (typeof bridgeLogSink === 'function') {
    bridgeLogSink('warn', msg)
  } else {
    console.warn(msg)
  }
}

function scanRunningRecompProcess() {
  if (process.platform !== 'linux' || !fs.existsSync('/proc')) {
    return null
  }
  let entries
  try {
    entries = fs.readdirSync('/proc', { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number.parseInt(entry.name, 10)
    if (pid === process.pid) continue

    let matchedName = null
    try {
      const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8')
      matchedName = normalizeProcessName(comm, RECOMP_PROCESS_NAMES, true)
    } catch {
      // Ignore exited/inaccessible process
    }

    const cmdTokens = readCmdlineTokens(pid)
    const cmdArgv0 = cmdTokens[0] || ''
    let matchedCmdExe = ''
    let cliUserDir = ''
    for (let i = 0; i < cmdTokens.length; i += 1) {
      const tok = cmdTokens[i]
      if (tok === '--user' && i + 1 < cmdTokens.length) {
        const candidateDir = normalizePossibleWinePath(cmdTokens[i + 1])
        if (candidateDir && fs.existsSync(candidateDir)) {
          cliUserDir = candidateDir
        }
        i += 1
        continue
      }
      if (tok.startsWith('--user=')) {
        const candidateDir = normalizePossibleWinePath(tok.slice('--user='.length))
        if (candidateDir && fs.existsSync(candidateDir)) {
          cliUserDir = candidateDir
        }
        continue
      }
      if (tok.startsWith('-')) continue
      const candidate = normalizeProcessName(tok, RECOMP_PROCESS_NAMES, false)
      if (candidate) {
        if (!matchedName) {
          matchedName = candidate
        }
        if (!matchedCmdExe) {
          matchedCmdExe = tok
        }
      }
    }

    let exePath = ''
    try {
      exePath = fs.readlinkSync(`/proc/${pid}/exe`)
      if (!matchedName) {
        matchedName = normalizeProcessName(exePath, RECOMP_PROCESS_NAMES, false)
      }
    } catch {
      // Ignore
    }

    if (!matchedName) continue

    let probeAddr = null
    try {
      const maps = fs.readFileSync(`/proc/${pid}/maps`, 'utf8')
      const isDirectHostVa = DIRECT_HOST_VA_PROCESS_NAMES.has(matchedName)
      for (const line of maps.split('\n')) {
        const match = /^([0-9a-f]+)-([0-9a-f]+)\s+([r-])/i.exec(line)
        if (!match || match[3] !== 'r') continue
        const start = BigInt(`0x${match[1]}`)
        const end = BigInt(`0x${match[2]}`)
        if (isDirectHostVa) {
          if (end > 0x7000000000n && start < 0x8000000000n) {
            const ovStart = start > 0x7000000000n ? start : 0x7000000000n
            const ovEnd = end < 0x8000000000n ? end : 0x8000000000n
            if (ovEnd - ovStart >= 8n) {
              probeAddr = ovStart
              break
            }
          }
        } else if (start <= 0x100080000000n && end >= 0x100080000008n) {
          probeAddr = 0x100080000000n
          break
        }
      }
      if (probeAddr === null) continue
    } catch {
      continue
    }

    let memFd = null
    try {
      memFd = fs.openSync(`/proc/${pid}/mem`, 'r')
      const probeBuf = Buffer.alloc(8)
      const bytesRead = fs.readSync(memFd, probeBuf, 0, 8, BigInt(probeAddr))
      if (bytesRead < 8) {
        continue
      }
    } catch (err) {
      const errCode = err && typeof err === 'object' && typeof err.code === 'string' ? err.code : ''
      if (errCode === 'EACCES' || errCode === 'EPERM') {
        warnPtraceProbeBlocked(pid, matchedName, errCode)
      }
      continue
    } finally {
      if (memFd !== null) {
        try {
          fs.closeSync(memFd)
        } catch {
          // Ignore close error
        }
      }
    }

    let saveDir = cliUserDir || null
    if (!saveDir && matchedCmdExe && /^[zZ]:[\\/]/.test(matchedCmdExe)) {
      saveDir = resolveUserSaveDirFromExe(matchedCmdExe)
    }
    if (!saveDir && /^[zZ]:[\\/]/.test(cmdArgv0)) {
      saveDir = resolveUserSaveDirFromExe(cmdArgv0)
    }
    if (!saveDir) {
      saveDir = resolveUserSaveDirFromExe(exePath)
    }

    return { pid, name: matchedName, saveDir }
  }

  return null
}

function detectRecompSaveDir(runningTarget) {
  if (runningTarget?.saveDir && fs.existsSync(runningTarget.saveDir)) {
    return runningTarget.saveDir
  }

  const longshotSaveDir = resolveLongshotSaveDir()
  if (longshotSaveDir) {
    return longshotSaveDir
  }

  const home = os.homedir()
  const candidates = [
    path.join(home, 'Games', 'Longshot', 'user'),
    path.join(home, 'Games', 'Hookshot', 'user'),
    path.join(home, 'Games', 'HeyListen', 'user'),
    path.join(home, 'Games', 'ProjectReLink', 'user'),
    path.join(home, 'Games', 'ProjectReLink', 'game', 'user'),
    path.join(home, 'Games', 'ReLink', 'user'),
    path.join(home, 'Games', 'ReLink', 'game', 'user'),
    path.join(home, 'Games', 'Triforce', 'user'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir
    }
  }
  return null
}

// Returns the profile folder of a running NX2Saria (saves in <profile>/save/<uid>/slot_*): NX2SARIA_PROFILE_DIR
// from its environment, resolved against the executable's folder, else the profile folder beside the executable.
function detectNx2SariaProfileDir() {
  if (process.platform !== 'linux' || !fs.existsSync('/proc')) {
    return null
  }
  let entries
  try {
    entries = fs.readdirSync('/proc', { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    try {
      const comm = fs.readFileSync(`/proc/${entry.name}/comm`, 'utf8').trim().toLowerCase()
      if (!NX2SARIA_PROCESS_NAMES.has(comm)) continue
      const exeDir = path.dirname(fs.readlinkSync(`/proc/${entry.name}/exe`))
      const environ = fs.readFileSync(`/proc/${entry.name}/environ`, 'utf8').split('\0')
      const profileVar = environ.find((kv) => kv.startsWith('NX2SARIA_PROFILE_DIR='))
      const profileSetting = profileVar?.slice('NX2SARIA_PROFILE_DIR='.length)
      const profileDir = profileSetting ? path.resolve(exeDir, profileSetting) : path.join(exeDir, 'profile')
      if (fs.existsSync(path.join(profileDir, 'save'))) {
        return profileDir
      }
    } catch {
      // Ignore exited/inaccessible process
    }
  }
  return null
}

function detectLinuxRuntime() {
  if (process.platform !== 'linux' || !fs.existsSync('/proc')) {
    return null
  }
  const recomp = scanRunningRecompProcess()
  if (recomp) {
    return {
      kind: 'recomp',
      name: recomp.name,
      displayName: RUNTIME_DISPLAY_NAMES[recomp.name] || recomp.name,
      pid: recomp.pid,
      saveDir: recomp.saveDir || detectRecompSaveDir(recomp),
      needsBridge: true,
    }
  }

  let entries
  try {
    entries = fs.readdirSync('/proc', { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number.parseInt(entry.name, 10)
    if (pid === process.pid) continue

    let matchedName = null
    try {
      const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8')
      matchedName = normalizeProcessName(comm, EMULATOR_PROCESS_NAMES, true)
    } catch {
      // Ignore
    }

    if (!matchedName) {
      for (const tok of readCmdlineTokens(pid)) {
        if (tok.startsWith('-')) continue
        matchedName = normalizeProcessName(tok, EMULATOR_PROCESS_NAMES, false)
        if (matchedName) break
      }
    }

    if (!matchedName) {
      try {
        const exePath = fs.readlinkSync(`/proc/${pid}/exe`)
        matchedName = normalizeProcessName(exePath, EMULATOR_PROCESS_NAMES, false)
      } catch {
        // Ignore
      }
    }

    if (matchedName) {
      return {
        kind: 'emulator',
        name: matchedName,
        displayName: RUNTIME_DISPLAY_NAMES[matchedName] || matchedName,
        pid,
        saveDir: null,
        needsBridge: false,
      }
    }
  }

  return null
}

function resolveRuntimePaths() {
  const resourcesDir = process.resourcesPath || __dirname
  const repoRoot = path.resolve(__dirname, '..', '..')

  const serverCandidates = [
    path.join(resourcesDir, 'app', 'standalone-server.mjs'),
    path.join(__dirname, 'app', 'standalone-server.mjs'),
    path.join(repoRoot, 'dist', 'standalone-server.mjs'),
  ]
  const serverEntry = serverCandidates.find((p) => fs.existsSync(p)) || serverCandidates[0]

  const distCandidates = [
    path.join(resourcesDir, 'app', 'dist'),
    path.join(__dirname, 'app', 'dist'),
    path.join(repoRoot, 'dist'),
  ]
  const distDir = distCandidates.find((p) => fs.existsSync(p)) || distCandidates[0]

  const bridgeCandidates = [
    path.join(resourcesDir, 'bin', 'longshot-rpc-bridge'),
    path.join(__dirname, 'bin', 'longshot-rpc-bridge'),
    path.join(repoRoot, 'release', 'OcarinaAtlas-Linux-x64', 'runtime', 'longshot-rpc-bridge'),
  ]
  const bridgeBin = bridgeCandidates.find((p) => fs.existsSync(p)) || bridgeCandidates[0]

  const iconCandidates = [
    path.join(resourcesDir, 'build', 'icon.png'),
    path.join(__dirname, 'build', 'icon.png'),
    path.join(repoRoot, 'public', 'icons', 'icon-512.png'),
  ]
  const iconPath = iconCandidates.find((p) => fs.existsSync(p)) || null

  return { serverEntry, distDir, bridgeBin, iconPath }
}

function readAppVersion() {
  const candidates = [
    path.join(__dirname, 'package.json'),
    path.join(__dirname, '..', '..', 'package.json'),
  ]
  for (const pkgPath of candidates) {
    try {
      if (!fs.existsSync(pkgPath)) continue
      const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      if (typeof parsed?.version === 'string' && parsed.version.trim()) {
        return parsed.version.trim()
      }
    } catch {
      // Try next
    }
  }
  return app.getVersion() || '2.3.0'
}

const SUPPORTED_LANGUAGES = [
  'en',
  'es',
  'fr',
  'pt',
  'zh-CN',
  'zh-TW',
  'de',
  'it',
  'ja',
  'ko',
  'nl',
  'ru',
  'pl',
  'tr',
  'uk',
]

function normalizeLanguage(raw) {
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().split('.')[0].split('@')[0].replace(/_/g, '-')
  if (!cleaned) return null
  const lower = cleaned.toLowerCase()

  const exact = SUPPORTED_LANGUAGES.find((code) => code.toLowerCase() === lower)
  if (exact) return exact

  const parts = lower.split('-')
  const base = parts[0]
  const region = parts[1] || ''
  if (base === 'zh') {
    if (region === 'tw' || region === 'hk' || region === 'mo' || region === 'hant') {
      return 'zh-TW'
    }
    return 'zh-CN'
  }
  const baseMatch = SUPPORTED_LANGUAGES.find((code) => code === base)
  return baseMatch || null
}

function detectDefaultLanguage() {
  try {
    const appLocale = typeof app?.getLocale === 'function' ? app.getLocale() : ''
    const fromApp = normalizeLanguage(appLocale)
    if (fromApp) return fromApp
  } catch {
    // Ignore if app.getLocale is unavailable
  }
  const envLocale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''
  return normalizeLanguage(envLocale) || 'en'
}

function getSettingsPath() {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
  return path.join(configHome, 'ocarina-atlas', 'launcher.json')
}

function loadSavedSettings() {
  try {
    const filePath = getSettingsPath()
    if (!fs.existsSync(filePath)) return {}
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveSettings(settings) {
  try {
    const filePath = getSettingsPath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

function getSaveSettingsPath() {
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config')
  return path.join(configHome, 'ocarina-atlas', 'settings.json')
}

function loadSaveSettings() {
  try {
    const filePath = getSaveSettingsPath()
    if (!fs.existsSync(filePath)) return {}
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function normalizeSavedSaveDirs(rawDirs, currentDir = '') {
  const result = []
  const seen = new Set()
  if (Array.isArray(rawDirs)) {
    for (const entry of rawDirs) {
      if (typeof entry !== 'string') continue
      const trimmed = entry.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      result.push(trimmed)
    }
  }
  const active = typeof currentDir === 'string' ? currentDir.trim() : ''
  if (active && !seen.has(active)) {
    result.push(active)
  }
  return result
}

function saveSaveSettings(settings) {
  try {
    const filePath = getSaveSettingsPath()
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const existing = loadSaveSettings()
    const customSaveDir = typeof settings.customSaveDir === 'string' ? settings.customSaveDir.trim() : ''
    const customSaveSlot = typeof settings.customSaveSlot === 'string' ? settings.customSaveSlot.trim() : ''
    const savedSaveDirs = normalizeSavedSaveDirs(settings.savedSaveDirs, customSaveDir)
    const merged = {
      ...existing,
      savedSaveDirs,
      customSaveDir,
      customSaveSlot,
    }
    fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

function terminateChild(child, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', done)
    try {
      child.kill('SIGTERM')
    } catch {
      done()
      return
    }
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGKILL')
        } catch {
          // Ignore
        }
      }
      done()
    }, timeoutMs)
    timer.unref()
  })
}

function fetchJsonHttp(url, timeoutMs = 600) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        resolve(null)
        return
      }
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          resolve(null)
        }
      })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

function postJsonHttp(url, body, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let payload = '{}'
    try {
      payload = JSON.stringify(body ?? {})
    } catch {
      resolve(null)
      return
    }
    const parsed = new URL(url)
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload, 'utf8'),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const raw = Buffer.concat(chunks).toString('utf8')
              resolve(raw ? JSON.parse(raw) : { ok: true })
            } catch {
              resolve({ ok: true })
            }
          } else {
            resolve(null)
          }
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
    req.write(payload)
    req.end()
  })
}

const MAX_REDIRECTS = 5

function isAllowedGitHubUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false
  try {
    const parsed = new URL(rawUrl.trim())
    return parsed.protocol === 'https:' && ALLOWED_GITHUB_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

function fetchHttpsJson(url, headers = {}, timeoutMs = 6000, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    if (!isAllowedGitHubUrl(url)) {
      reject(new Error('Blocked untrusted update host'))
      return
    }
    const req = https.get(
      url,
      {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Ocarina-Atlas-Linux-Launcher',
          Accept: 'application/vnd.github+json',
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'))
            return
          }
          let nextUrl
          try {
            nextUrl = new URL(res.headers.location, url).toString()
          } catch {
            reject(new Error('Invalid redirect URL'))
            return
          }
          if (!isAllowedGitHubUrl(nextUrl)) {
            reject(new Error('Blocked untrusted redirect host'))
            return
          }
          fetchHttpsJson(nextUrl, headers, timeoutMs, redirectsLeft - 1).then(resolve, reject)
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API HTTP ${res.statusCode}`))
            return
          }
          try {
            resolve(JSON.parse(text))
          } catch {
            reject(new Error('Invalid JSON from GitHub'))
          }
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timed out'))
    })
    req.on('error', reject)
  })
}

function fetchHttpsText(url, timeoutMs = 15000, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    if (!isAllowedGitHubUrl(url)) {
      reject(new Error('Blocked untrusted update host'))
      return
    }
    const req = https.get(
      url,
      {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Ocarina-Atlas-Linux-Launcher',
          Accept: 'text/plain, application/octet-stream, */*',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'))
            return
          }
          let nextUrl
          try {
            nextUrl = new URL(res.headers.location, url).toString()
          } catch {
            reject(new Error('Invalid redirect URL'))
            return
          }
          if (!isAllowedGitHubUrl(nextUrl)) {
            reject(new Error('Blocked untrusted redirect host'))
            return
          }
          fetchHttpsText(nextUrl, timeoutMs, redirectsLeft - 1).then(resolve, reject)
          return
        }
        const chunks = []
        let totalLen = 0
        res.on('data', (c) => {
          totalLen += c.length
          if (totalLen <= 65536) {
            chunks.push(c)
          }
        })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub download HTTP ${res.statusCode}`))
            return
          }
          resolve(Buffer.concat(chunks).toString('utf8'))
        })
      },
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Checksum download timed out'))
    })
    req.on('error', reject)
  })
}

function parseSha256Digest(rawText) {
  const text = String(rawText ?? '').trim()
  const match = /\b([0-9a-fA-F]{64})\b/.exec(text)
  if (!match) {
    throw new Error('Invalid or missing 64-character hex SHA-256 digest in .sha256 sidecar')
  }
  return match[1].toLowerCase()
}

function downloadHttpsToFileWithSha256(
  url,
  destPath,
  onProgress,
  timeoutMs = 120000,
  redirectsLeft = MAX_REDIRECTS,
) {
  return new Promise((resolve, reject) => {
    if (!isAllowedGitHubUrl(url)) {
      reject(new Error('Blocked untrusted update host'))
      return
    }
    const req = https.get(
      url,
      {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Ocarina-Atlas-Linux-Launcher',
          Accept: 'application/octet-stream, */*',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects'))
            return
          }
          let nextUrl
          try {
            nextUrl = new URL(res.headers.location, url).toString()
          } catch {
            reject(new Error('Invalid redirect URL'))
            return
          }
          if (!isAllowedGitHubUrl(nextUrl)) {
            reject(new Error('Blocked untrusted redirect host'))
            return
          }
          downloadHttpsToFileWithSha256(nextUrl, destPath, onProgress, timeoutMs, redirectsLeft - 1).then(
            resolve,
            reject,
          )
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`AppImage download HTTP ${res.statusCode}`))
          return
        }

        const totalBytes = Number.parseInt(String(res.headers['content-length'] || '0'), 10) || 0
        let downloadedBytes = 0
        let lastProgressAt = 0
        const hash = crypto.createHash('sha256')
        const outStream = fs.createWriteStream(destPath, { mode: 0o600 })
        let settled = false

        const fail = (err) => {
          if (settled) return
          settled = true
          res.destroy()
          outStream.destroy()
          try {
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
          } catch {
            // Ignore cleanup error
          }
          reject(err)
        }

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length
          hash.update(chunk)
          const now = Date.now()
          if (typeof onProgress === 'function' && (now - lastProgressAt >= 80 || downloadedBytes === totalBytes)) {
            lastProgressAt = now
            const percent =
              totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : null
            onProgress({
              stage: 'downloading',
              downloadedBytes,
              totalBytes,
              percent,
            })
          }
        })

        res.on('error', fail)
        outStream.on('error', fail)

        outStream.on('finish', () => {
          outStream.close((closeErr) => {
            if (closeErr) {
              fail(closeErr)
              return
            }
            if (settled) return
            settled = true
            resolve({
              actualSha256: hash.digest('hex').toLowerCase(),
              downloadedBytes,
              totalBytes,
            })
          })
        })

        res.pipe(outStream)
      },
    )

    req.on('timeout', () => {
      req.destroy()
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
      } catch {
        // Ignore
      }
      reject(new Error('AppImage download timed out'))
    })
    req.on('error', (err) => {
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
      } catch {
        // Ignore
      }
      reject(err)
    })
  })
}

function parseSemver(raw) {
  const clean = String(raw ?? '').trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(clean)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    pre: match[4] || '',
  }
}

function isNewerSemver(candidateRaw, currentRaw) {
  const a = parseSemver(candidateRaw)
  const b = parseSemver(currentRaw)
  if (!a || !b) return false
  if (a.major !== b.major) return a.major > b.major
  if (a.minor !== b.minor) return a.minor > b.minor
  if (a.patch !== b.patch) return a.patch > b.patch
  // A stable release (no prerelease tag) is newer than a prerelease of the same X.Y.Z
  if (b.pre && !a.pre) return true
  return false
}

async function checkForUpdates(currentVersion) {
  try {
    const release = await fetchHttpsJson(OFFICIAL_RELEASES_API_URL)
    if (!release || release.draft || release.prerelease) {
      return {
        status: 'up-to-date',
        currentVersion,
        latestVersion: currentVersion,
        releaseUrl: OFFICIAL_REPO_URL + '/releases/latest',
        appImageDownloadUrl: '',
        sha256DownloadUrl: '',
        canSelfUpdate: false,
      }
    }
    const htmlUrl = String(release.html_url || '')
    if (!htmlUrl.startsWith(OFFICIAL_REPO_URL + '/') || !isAllowedGitHubUrl(htmlUrl)) {
      return { status: 'error', currentVersion, error: 'Untrusted release URL', canSelfUpdate: false }
    }

    let appImageDownloadUrl = ''
    let sha256DownloadUrl = ''
    const assets = Array.isArray(release.assets) ? release.assets : []
    for (const asset of assets) {
      if (!asset || typeof asset !== 'object') continue
      const assetName = String(asset.name || '').trim()
      const downloadUrl = String(asset.browser_download_url || '').trim()
      if (!isAllowedGitHubUrl(downloadUrl)) continue
      if (assetName === LINUX_APPIMAGE_ASSET_NAME) {
        appImageDownloadUrl = downloadUrl
      } else if (assetName === LINUX_APPIMAGE_SHA256_ASSET_NAME) {
        sha256DownloadUrl = downloadUrl
      }
    }

    const latestTag = String(release.tag_name || '').trim()
    const hasUpdate = isNewerSemver(latestTag, currentVersion)
    const canSelfUpdate = Boolean(process.env.APPIMAGE && appImageDownloadUrl && sha256DownloadUrl)
    return {
      status: hasUpdate ? 'update-available' : 'up-to-date',
      currentVersion,
      latestVersion: latestTag.replace(/^v/i, '') || currentVersion,
      releaseUrl: htmlUrl,
      publishedAt: release.published_at || '',
      appImageDownloadUrl,
      sha256DownloadUrl,
      canSelfUpdate,
    }
  } catch (err) {
    return {
      status: 'error',
      currentVersion,
      error: err instanceof Error ? err.message : String(err),
      canSelfUpdate: false,
    }
  }
}

const checkOfficialUpdates = checkForUpdates

async function applyAppImageUpdate(updateInfo, onProgress = () => {}) {
  const appImagePath = typeof process.env.APPIMAGE === 'string' ? process.env.APPIMAGE.trim() : ''
  if (!appImagePath) {
    throw new Error('In-place update requires running from a packaged Linux AppImage (APPIMAGE is unset).')
  }
  if (!fs.existsSync(appImagePath) || !fs.statSync(appImagePath).isFile()) {
    throw new Error(`Current AppImage file was not found on disk: ${appImagePath}`)
  }
  try {
    fs.accessSync(appImagePath, fs.constants.W_OK)
    fs.accessSync(path.dirname(appImagePath), fs.constants.W_OK)
  } catch {
    throw new Error(`Current AppImage location is not writable: ${appImagePath}`)
  }

  const appImageDownloadUrl = String(updateInfo?.appImageDownloadUrl || '').trim()
  const sha256DownloadUrl = String(updateInfo?.sha256DownloadUrl || '').trim()
  if (!isAllowedGitHubUrl(appImageDownloadUrl) || !isAllowedGitHubUrl(sha256DownloadUrl)) {
    throw new Error('Missing or untrusted official GitHub asset URLs for AppImage update.')
  }

  const tmpPath = `${appImagePath}.update.tmp`
  try {
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath)
    }
  } catch {
    // Ignore stale temporary file cleanup errors
  }

  onProgress({ stage: 'fetching-checksum', percent: 0 })
  const sha256Raw = await fetchHttpsText(sha256DownloadUrl, 15000, MAX_REDIRECTS)
  const expectedSha256 = parseSha256Digest(sha256Raw)

  onProgress({ stage: 'downloading', downloadedBytes: 0, totalBytes: 0, percent: 0 })
  const { actualSha256, downloadedBytes } = await downloadHttpsToFileWithSha256(
    appImageDownloadUrl,
    tmpPath,
    onProgress,
    120000,
    MAX_REDIRECTS,
  )

  onProgress({ stage: 'verifying', percent: 100 })
  if (actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath)
      }
    } catch {
      // Ignore cleanup error
    }
    throw new Error(
      `SHA-256 verification failed: expected ${expectedSha256}, computed ${actualSha256}. Temporary update deleted.`,
    )
  }

  try {
    fs.chmodSync(tmpPath, 0o755)
    fs.renameSync(tmpPath, appImagePath)
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath)
      }
    } catch {
      // Ignore cleanup error
    }
    throw err
  }

  onProgress({
    stage: 'complete',
    percent: 100,
    sha256: actualSha256,
    downloadedBytes,
    appImagePath,
  })

  return {
    ok: true,
    appImagePath,
    sha256: actualSha256,
    downloadedBytes,
    version: updateInfo?.latestVersion || '',
  }
}

async function main() {
  let cliOpts
  try {
    cliOpts = parseArgs(getCliArgs(), process.env)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    console.error('Run with --help for usage.')
    process.exit(2)
  }

  if (cliOpts.help) {
    printHelp()
    process.exit(0)
  }

  if (cliOpts.setupSync) {
    const res = setupSync(cliOpts.lichiiHost, cliOpts.lichiiPort)
    if (res.updated.length === 0) {
      console.log('No existing Lichii, Fritchii, or CheezyEmu profile directory was found.')
      console.log(`Create the profile directory or add manually: ${res.line}`)
    } else {
      console.log(`Configured ${res.line} in:`)
      for (const p of res.updated) console.log(`  - ${p}`)
    }
    process.exit(0)
  }

  const paths = resolveRuntimePaths()
  if (!fs.existsSync(paths.serverEntry)) {
    console.error(`FATAL: Missing standalone server at ${paths.serverEntry}`)
    process.exit(1)
  }
  if (
    !fs.existsSync(path.join(paths.distDir, 'client')) ||
    !fs.existsSync(path.join(paths.distDir, 'server', 'server.js'))
  ) {
    console.error(`FATAL: Missing built dist/client or dist/server under ${paths.distDir}`)
    process.exit(1)
  }

  const appVersion = readAppVersion()
  const saved = loadSavedSettings()
  const savedSave = loadSaveSettings()
  const hasDisplay = Boolean(process.env.DISPLAY?.trim() || process.env.WAYLAND_DISPLAY?.trim())
  const isHeadless = cliOpts.noBrowser || cliOpts.cli || !hasDisplay

  const initialCustomSaveDir =
    cliOpts.saveDir || (typeof savedSave.customSaveDir === 'string' ? savedSave.customSaveDir.trim() : '')
  const initialLanguage =
    normalizeLanguage(saved.language) || normalizeLanguage(savedSave.language) || detectDefaultLanguage()

  const state = {
    version: appVersion,
    headless: isHeadless,
    lifecycle: 'stopped', // 'stopped' | 'starting' | 'running'
    port: cliOpts.port !== DEFAULT_PORT || process.env.PORT ? cliOpts.port : parsePort(saved.port, DEFAULT_PORT, true),
    host: cliOpts.lanExplicit ? cliOpts.host : (typeof saved.host === 'string' && saved.host.trim() ? saved.host.trim() : cliOpts.host),
    lichiiHost:
      process.env.LICHII_HOST || cliOpts.lichiiHost !== DEFAULT_LICHII_HOST
        ? cliOpts.lichiiHost
        : (typeof saved.lichiiHost === 'string' && saved.lichiiHost.trim() ? saved.lichiiHost.trim() : cliOpts.lichiiHost),
    lichiiPort:
      process.env.LICHII_PORT || cliOpts.lichiiPort !== DEFAULT_LICHII_PORT
        ? cliOpts.lichiiPort
        : parsePort(saved.lichiiPort, cliOpts.lichiiPort, false),
    autoOpen: typeof saved.autoOpen === 'boolean' ? saved.autoOpen : true,
    autoStart: typeof saved.autoStart === 'boolean' ? saved.autoStart : true,
    language: initialLanguage,
    savedSaveDirs: normalizeSavedSaveDirs(savedSave.savedSaveDirs, initialCustomSaveDir),
    customSaveDir: initialCustomSaveDir,
    customSaveSlot: cliOpts.saveSlot || (typeof savedSave.customSaveSlot === 'string' ? savedSave.customSaveSlot.trim() : ''),
    localUrl: '',
    boundPort: cliOpts.port,
    lanUrls: [],
    runtime: null,
    telemetry: null,
    ptraceScope: readYamaPtraceScope(),
    syncMessage: '',
    syncStatus: 'idle', // 'idle' | 'ok' | 'warn'
    updateInfo: null,
    logs: [],
  }

  let mainWindow = null
  let serverChild = null
  let bridgeChild = null
  let bridgePollInFlight = false
  let shuttingDown = false
  let warnedPtrace = false
  let bridgeTimer = null
  let telemetryTimer = null

  function emitLog(level, msg) {
    const line = `[${new Date().toTimeString().slice(0, 8)}] ${msg}`
    state.logs.push({ level, line })
    if (state.logs.length > MAX_LOG_LINES) {
      state.logs.splice(0, state.logs.length - MAX_LOG_LINES)
    }
    if (isHeadless) {
      if (level === 'error') console.error(msg)
      else console.log(msg)
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launcher:log', { level, line })
    }
  }

  bridgeLogSink = emitLog

  function pushState() {
    state.lanUrls = isWildcardBindHost(state.host)
      ? collectLanUrls(state.boundPort || state.port)
      : []
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launcher:state', getPublicState())
    }
  }

  function getPublicState() {
    return {
      version: state.version,
      lifecycle: state.lifecycle,
      port: state.port,
      host: state.host,
      lichiiHost: state.lichiiHost,
      lichiiPort: state.lichiiPort,
      autoOpen: state.autoOpen,
      autoStart: state.autoStart,
      language: state.language,
      savedSaveDirs: state.savedSaveDirs,
      customSaveDir: state.customSaveDir,
      customSaveSlot: state.customSaveSlot,
      localUrl: state.localUrl,
      boundPort: state.boundPort,
      lanUrls: state.lanUrls,
      runtime: state.runtime,
      telemetry: state.telemetry,
      ptraceScope: state.ptraceScope,
      syncMessage: state.syncMessage,
      syncStatus: state.syncStatus,
      updateInfo: state.updateInfo,
    }
  }

  function persistSettings() {
    saveSettings({
      port: state.port,
      host: state.host,
      lichiiHost: state.lichiiHost,
      lichiiPort: state.lichiiPort,
      autoOpen: state.autoOpen,
      autoStart: state.autoStart,
      language: state.language,
    })
  }

  function persistSaveSettings() {
    state.savedSaveDirs = normalizeSavedSaveDirs(state.savedSaveDirs, state.customSaveDir)
    saveSaveSettings({
      savedSaveDirs: state.savedSaveDirs,
      customSaveDir: state.customSaveDir,
      customSaveSlot: state.customSaveSlot,
    })
  }

  async function postSaveSlotUpdate() {
    if (state.lifecycle !== 'running' || !state.boundPort) return null
    const payload = {
      saveDir: state.customSaveDir || null,
      slot: state.customSaveSlot || null,
    }
    const res = await postJsonHttp(`http://127.0.0.1:${state.boundPort}/api/saves/slot`, payload, 1500)
    if (res && res.ok !== false) {
      emitLog(
        'info',
        `[saves] Updated save source: dir=${state.customSaveDir || 'auto-detect'}, slot=${state.customSaveSlot || 'auto'}`,
      )
      void pollTelemetry()
    } else {
      emitLog('warn', '[saves] Failed to push save folder/slot update to running server.')
    }
    return res
  }

  async function manageBridge() {
    if (shuttingDown || bridgePollInFlight) return
    bridgePollInFlight = true
    try {
      state.ptraceScope = readYamaPtraceScope()
      state.runtime = detectLinuxRuntime()

      if (
        isLoopbackHost(state.lichiiHost) &&
        paths.bridgeBin &&
        fs.existsSync(paths.bridgeBin) &&
        (!bridgeChild || bridgeChild.exitCode !== null || bridgeChild.signalCode !== null)
      ) {
        const portBusy = await probeTcpPort('127.0.0.1', state.lichiiPort, 150)
        if (!portBusy) {
          const target = scanRunningRecompProcess()
          if (target) {
            if (!warnedPtrace && state.ptraceScope !== null && state.ptraceScope !== 0) {
              warnedPtrace = true
              emitLog(
                'warn',
                `[bridge] Warning: /proc/sys/kernel/yama/ptrace_scope is ${state.ptraceScope} while ${target.name} (PID ${target.pid}) is running.`,
              )
              emitLog('warn', '[bridge] Run: sudo sysctl kernel.yama.ptrace_scope=0')
            }

            const child = spawn(paths.bridgeBin, ['--port', String(state.lichiiPort), '--once'], {
              stdio: ['ignore', 'pipe', 'pipe'],
            })
            bridgeChild = child
            emitLog(
              'info',
              `[bridge] Started read-only Longshot RPC bridge on 127.0.0.1:${state.lichiiPort} (PID ${target.pid}, ${target.name}).`,
            )

            const forward = (stream, lvl) => {
              if (!stream) return
              readline.createInterface({ input: stream }).on('line', (line) => {
                if (line.trim()) emitLog(lvl, `[bridge] ${line}`)
              })
            }
            forward(child.stdout, 'info')
            forward(child.stderr, 'error')

            child.once('exit', (code, signal) => {
              if (bridgeChild === child) bridgeChild = null
              if (!shuttingDown && code !== 0 && code !== null) {
                emitLog('warn', `[bridge] Exited with code ${code}${signal ? ` (${signal})` : ''}.`)
              }
            })
            child.once('error', (err) => {
              if (bridgeChild === child) bridgeChild = null
              emitLog('error', `[bridge] Failed to start: ${err.message}`)
            })
          }
        }
      }
    } finally {
      bridgePollInFlight = false
      pushState()
    }
  }

  async function pollTelemetry() {
    if (shuttingDown) return
    if (state.lifecycle !== 'running' || !state.boundPort) {
      if (state.telemetry !== null) {
        state.telemetry = null
        pushState()
      }
      return
    }
    const data = await fetchJsonHttp(`http://127.0.0.1:${state.boundPort}/api/lichii/state`, 600)
    state.telemetry = data
    pushState()
  }

  function startServer() {
    if (serverChild || state.lifecycle !== 'stopped') return
    state.lifecycle = 'starting'
    state.localUrl = ''
    state.boundPort = state.port
    pushState()

    const runningTarget = scanRunningRecompProcess()
    const detectedSaveDir =
      process.env.LONGSHOT_SAVE_DIR?.trim() || detectRecompSaveDir(runningTarget)
    const nx2sariaSaveDir =
      process.env.NX2SARIA_SAVE_DIR?.trim() || detectNx2SariaProfileDir()

    const serverEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      HOST: state.host,
      PORT: String(state.port),
      LICHII_HOST: state.lichiiHost,
      LICHII_PORT: String(state.lichiiPort),
      APP_DIST_DIR: paths.distDir,
    }
    if (detectedSaveDir && !serverEnv.LONGSHOT_SAVE_DIR) {
      serverEnv.LONGSHOT_SAVE_DIR = detectedSaveDir
    }
    if (nx2sariaSaveDir && !serverEnv.NX2SARIA_SAVE_DIR) {
      serverEnv.NX2SARIA_SAVE_DIR = nx2sariaSaveDir
    }
    if (state.customSaveDir) {
      serverEnv.CUSTOM_SAVE_DIR = state.customSaveDir
    } else {
      delete serverEnv.CUSTOM_SAVE_DIR
    }
    if (state.customSaveSlot) {
      serverEnv.CUSTOM_SAVE_SLOT = state.customSaveSlot
    } else {
      delete serverEnv.CUSTOM_SAVE_SLOT
    }

    emitLog('info', `[server] Starting Ocarina Atlas on ${state.host}:${state.port}...`)
    const child = spawn(
      process.execPath,
      [paths.serverEntry, '--host', state.host, '--port', String(state.port)],
      {
        env: serverEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    serverChild = child

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return

      if (trimmed.startsWith('READY ')) {
        const url = trimmed.slice('READY '.length).trim()
        let boundPort = state.port
        try {
          boundPort = Number.parseInt(new URL(url).port, 10) || state.port
        } catch {
          // Ignore
        }
        state.lifecycle = 'running'
        state.localUrl = url
        state.boundPort = boundPort
        emitLog('info', `[server] Ready at ${url}`)
        pushState()

        if (!isHeadless && state.autoOpen) {
          void shell.openExternal(url)
        }
        return
      }

      if (trimmed.startsWith('LAN ')) return
      emitLog('info', `[server] ${trimmed}`)
    })

    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      if (line.trim()) emitLog('error', `[server:err] ${line}`)
    })

    child.once('error', (err) => {
      emitLog('error', `[server] Failed to spawn: ${err.message}`)
      if (serverChild === child) serverChild = null
      state.lifecycle = 'stopped'
      state.localUrl = ''
      state.telemetry = null
      pushState()
    })

    child.once('exit', (code, signal) => {
      if (serverChild === child) serverChild = null
      const wasRunning = state.lifecycle !== 'stopped'
      state.lifecycle = 'stopped'
      state.localUrl = ''
      state.telemetry = null
      if (!shuttingDown && wasRunning) {
        emitLog(
          code === 0 ? 'info' : 'warn',
          `[server] Stopped (code=${code ?? 'null'}${signal ? `, signal=${signal}` : ''}).`,
        )
      }
      pushState()
      if (isHeadless && !shuttingDown) {
        void shutdown(signal ? `server-${signal}` : `server-exit-${code ?? 0}`, code ?? 0)
      }
    })
  }

  async function stopServer() {
    if (!serverChild) {
      state.lifecycle = 'stopped'
      state.localUrl = ''
      state.telemetry = null
      pushState()
      return
    }
    const child = serverChild
    emitLog('info', '[server] Stopping Ocarina Atlas...')
    await terminateChild(child, 2500)
    if (serverChild === child) serverChild = null
    state.lifecycle = 'stopped'
    state.localUrl = ''
    state.telemetry = null
    pushState()
  }

  async function shutdown(reason, exitCode = 0) {
    if (shuttingDown) return
    shuttingDown = true
    if (bridgeTimer) clearInterval(bridgeTimer)
    if (telemetryTimer) clearInterval(telemetryTimer)
    if (isHeadless) {
      console.log(`Shutting down Ocarina Atlas (${reason})...`)
    }
    await Promise.all([
      terminateChild(serverChild, 2500),
      terminateChild(bridgeChild, 1500),
    ])
    serverChild = null
    bridgeChild = null
    if (isHeadless) {
      process.exit(exitCode)
    } else {
      app.exit(exitCode)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT', 0))
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0))
  process.on('SIGHUP', () => void shutdown('SIGHUP', 0))

  // Headless mode: never initialize a BrowserWindow
  if (isHeadless) {
    await manageBridge()
    bridgeTimer = setInterval(() => void manageBridge(), 2000)
    bridgeTimer.unref()
    startServer()
    return
  }

  // GUI mode via Electron BrowserWindow
  await app.whenReady()

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT_COMPACT,
      minWidth: 520,
      minHeight: 460,
      backgroundColor: '#13100C',
      title: 'Ocarina Atlas',
      autoHideMenuBar: true,
      icon: paths.iconPath || undefined,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    mainWindow.setMenuBarVisibility(false)
    void mainWindow.loadFile(path.join(__dirname, 'index.html'))

    mainWindow.on('closed', () => {
      mainWindow = null
    })
  }

  ipcMain.handle('launcher:get-state', () => ({
    ...getPublicState(),
    logs: state.logs,
  }))

  ipcMain.handle('launcher:start-server', () => {
    startServer()
    return { ok: true }
  })

  ipcMain.handle('launcher:stop-server', async () => {
    await stopServer()
    return { ok: true }
  })

  ipcMain.handle('launcher:open-map', async () => {
    if (state.localUrl) {
      await shell.openExternal(state.localUrl)
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle('launcher:open-external', async (_ev, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle('launcher:copy-text', (_ev, text) => {
    if (typeof text === 'string' && text.length > 0) {
      clipboard.writeText(text)
      return { ok: true }
    }
    return { ok: false }
  })

  ipcMain.handle('launcher:setup-sync', () => {
    const res = setupSync(state.lichiiHost, state.lichiiPort)
    if (res.updated.length > 0) {
      state.syncStatus = 'ok'
      state.syncMessage = `Configured ${res.line} in ${res.updated.length} profile(s). Restart emulator to apply.`
      emitLog('info', `[sync] Configured ${res.line} in ${res.updated.join(', ')}`)
    } else {
      state.syncStatus = 'warn'
      state.syncMessage = `No Lichii/Fritchii/CheezyEmu profile found. Add ${res.line} to nx2_switches.txt.`
      emitLog('warn', `[sync] No existing profile directory found for ${res.line}`)
    }
    pushState()
    return res
  })

  ipcMain.handle('launcher:refresh-lan', () => {
    pushState()
    return { lanUrls: state.lanUrls }
  })

  ipcMain.handle('launcher:toggle-lan', async (_ev, enabled) => {
    const nextHost = enabled ? DEFAULT_HOST : '127.0.0.1'
    if (state.host === nextHost) return getPublicState()
    const wasRunning = state.lifecycle !== 'stopped'
    state.host = nextHost
    persistSettings()
    if (wasRunning) {
      await stopServer()
      startServer()
    } else {
      pushState()
    }
    return getPublicState()
  })

  ipcMain.handle('launcher:browse-save-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: 'Select Custom Save Folder',
      defaultPath: state.customSaveDir || undefined,
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true, state: getPublicState() }
    }
    const selected = String(result.filePaths[0] || '').trim()
    if (!selected) {
      return { canceled: true, state: getPublicState() }
    }
    state.savedSaveDirs = normalizeSavedSaveDirs(state.savedSaveDirs, selected)
    state.customSaveDir = selected
    persistSaveSettings()
    pushState()
    if (state.lifecycle === 'running' && state.boundPort) {
      await postSaveSlotUpdate()
    }
    return { canceled: false, saveDir: selected, state: getPublicState() }
  })

  ipcMain.handle('launcher:remove-save-dir', async (_ev, dir) => {
    const target = typeof dir === 'string' && dir.trim() ? dir.trim() : state.customSaveDir
    if (!target) {
      return getPublicState()
    }
    state.savedSaveDirs = state.savedSaveDirs.filter((entry) => entry !== target)
    if (state.customSaveDir === target) {
      state.customSaveDir = ''
    }
    persistSaveSettings()
    pushState()
    if (state.lifecycle === 'running' && state.boundPort) {
      await postSaveSlotUpdate()
    }
    return getPublicState()
  })

  ipcMain.handle('launcher:update-settings', async (_ev, patch) => {
    if (!patch || typeof patch !== 'object') return getPublicState()
    if (state.lifecycle === 'stopped') {
      if (patch.port !== undefined) {
        const p = parsePort(patch.port, state.port, false)
        state.port = p
        state.boundPort = p
      }
      if (typeof patch.host === 'string' && patch.host.trim()) {
        state.host = patch.host.trim()
      }
      if (typeof patch.lichiiHost === 'string' && patch.lichiiHost.trim()) {
        state.lichiiHost = patch.lichiiHost.trim()
      }
      if (patch.lichiiPort !== undefined) {
        state.lichiiPort = parsePort(patch.lichiiPort, state.lichiiPort, false)
      }
    }
    if (typeof patch.autoOpen === 'boolean') state.autoOpen = patch.autoOpen
    if (typeof patch.autoStart === 'boolean') state.autoStart = patch.autoStart
    if (typeof patch.language === 'string') {
      const nextLang = normalizeLanguage(patch.language)
      if (nextLang) state.language = nextLang
    }
    let saveSettingsChanged = false
    if (typeof patch.customSaveDir === 'string') {
      const nextDir = patch.customSaveDir.trim()
      if (nextDir && !state.savedSaveDirs.includes(nextDir)) {
        state.savedSaveDirs = [...state.savedSaveDirs, nextDir]
        saveSettingsChanged = true
      }
      if (nextDir !== state.customSaveDir) {
        state.customSaveDir = nextDir
        saveSettingsChanged = true
      }
    }
    if (typeof patch.customSaveSlot === 'string') {
      const nextSlot = patch.customSaveSlot.trim()
      if (nextSlot !== state.customSaveSlot) {
        state.customSaveSlot = nextSlot
        saveSettingsChanged = true
      }
    }
    persistSettings()
    if (saveSettingsChanged) {
      persistSaveSettings()
      if (state.lifecycle === 'running' && state.boundPort) {
        await postSaveSlotUpdate()
      }
    }
    pushState()
    return getPublicState()
  })

  ipcMain.handle('launcher:set-language', (_ev, lang) => {
    const nextLang = normalizeLanguage(lang)
    if (nextLang && nextLang !== state.language) {
      state.language = nextLang
      persistSettings()
      pushState()
    }
    return getPublicState()
  })

  ipcMain.handle('launcher:reset-rpc-defaults', () => {
    if (state.lifecycle === 'stopped') {
      state.lichiiHost = DEFAULT_LICHII_HOST
      state.lichiiPort = DEFAULT_LICHII_PORT
      persistSettings()
      pushState()
    }
    return getPublicState()
  })

  ipcMain.handle('launcher:check-updates', async () => {
    const info = await checkForUpdates(state.version)
    state.updateInfo = info
    pushState()
    return info
  })

  let updateInFlight = false
  function emitUpdateProgress(progress) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('launcher:update-progress', progress)
    }
  }

  async function handleApplyUpdate(_ev, opts = {}) {
    if (updateInFlight) {
      return { ok: false, error: 'An update is already in progress.' }
    }
    updateInFlight = true
    try {
      if (!state.updateInfo || !state.updateInfo.appImageDownloadUrl || !state.updateInfo.sha256DownloadUrl) {
        state.updateInfo = await checkForUpdates(state.version)
        pushState()
      }
      emitLog(
        'info',
        `[update] Downloading v${state.updateInfo?.latestVersion || 'latest'} AppImage and .sha256 checksum...`,
      )
      const res = await applyAppImageUpdate(state.updateInfo, emitUpdateProgress)
      emitLog(
        'info',
        `[update] SHA-256 verified (${res.sha256.slice(0, 12)}...). Replaced ${res.appImagePath} in-place.`,
      )
      if (opts?.relaunch !== false) {
        setTimeout(() => {
          void (async () => {
            try {
              await Promise.all([
                terminateChild(serverChild, 2000),
                terminateChild(bridgeChild, 1000),
              ])
              serverChild = null
              bridgeChild = null
            } catch {
              // Ignore child shutdown errors before relaunch
            }
            try {
              const cleanEnv = { ...process.env }
              delete cleanEnv.APPDIR
              delete cleanEnv.APPIMAGE
              delete cleanEnv.ARGV0
              delete cleanEnv.OWD
              delete cleanEnv.APPIMAGE_UUID
              const child = spawn(res.appImagePath, getCliArgs(), {
                detached: true,
                stdio: 'ignore',
                env: cleanEnv,
              })
              child.unref()
            } catch {
              try {
                app.relaunch({ execPath: res.appImagePath, args: getCliArgs() })
              } catch {
                // Ignore relaunch error in test environments
              }
            }
            void shutdown('self-update-relaunch', 0)
          })()
        }, 450)
      }
      return res
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      emitLog('error', `[update] ${errorMsg}`)
      emitUpdateProgress({ stage: 'error', error: errorMsg })
      return { ok: false, error: errorMsg }
    } finally {
      updateInFlight = false
    }
  }

  ipcMain.handle('apply-update', handleApplyUpdate)
  ipcMain.handle('launcher:apply-update', handleApplyUpdate)

  ipcMain.handle('launcher:clear-logs', () => {
    state.logs = []
    return { ok: true }
  })

  ipcMain.handle('launcher:set-drawer-open', (_ev, open) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const [w] = mainWindow.getSize()
      const targetHeight = open ? WINDOW_HEIGHT_EXPANDED : WINDOW_HEIGHT_COMPACT
      mainWindow.setSize(w, targetHeight, true)
    }
    return { ok: true }
  })

  createWindow()

  await manageBridge()
  bridgeTimer = setInterval(() => void manageBridge(), 2000)
  telemetryTimer = setInterval(() => void pollTelemetry(), 1200)

  if (state.autoStart) {
    startServer()
  }

  // Silent background update check
  void checkOfficialUpdates(state.version).then((info) => {
    state.updateInfo = info
    pushState()
  })

  app.on('window-all-closed', () => {
    void shutdown('window-all-closed', 0)
  })

  app.on('before-quit', (ev) => {
    if (!shuttingDown) {
      ev.preventDefault()
      void shutdown('before-quit', 0)
    }
  })
}

void main()
