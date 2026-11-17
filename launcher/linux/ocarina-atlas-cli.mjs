import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const DEFAULT_HOST = '0.0.0.0'
export const DEFAULT_PORT = 3000
export const DEFAULT_LICHII_HOST = '127.0.0.1'
export const DEFAULT_LICHII_PORT = 6545
export const RECOMP_PROCESS_NAMES = new Set([
  'hookshot',
  'longshot',
  'heylisten',
  'relink-game',
  'relink',
  'triforce',
])
// NX2Saria serves the debug RPC on 127.0.0.1:6545 itself, so only its save folder is detected
export const NX2SARIA_PROCESS_NAMES = new Set(['ocarina', 'nx2saria'])
export const EMULATOR_PROCESS_NAMES = new Set([
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
  hookshot: 'Hookshot',
  longshot: 'Longshot',
  heylisten: 'HeyListen',
  'relink-game': 'Project ReLink',
  relink: 'Project ReLink',
  triforce: 'Triforce',
}

const VIRTUAL_ADAPTER_PATTERN =
  /(?:vethernet|hyper-v|wsl|virtualbox|vbox|vmware|docker|veth|utun|wintun|tailscale|zerotier|wireguard|nordlynx|radmin|hamachi|openvpn|bluetooth|loopback|npcap|isatap|teredo|\btap(?:[\s_-]?\d+|\b)|\btun(?:[\s_-]?\d+|\b))/i

function printBanner() {
  console.log('====================================================================')
  console.log('  Ocarina Atlas — Pre-release / Experimental Linux Build')
  console.log('  https://github.com/antonioalvromero/Ocarina-Atlas (GNU AGPL-3.0)')
  console.log('====================================================================')
}

function printHelp() {
  printBanner()
  console.log(`
Usage: ./OcarinaAtlas [options]

Options:
  --port <n>          HTTP port for the map server (default: ${DEFAULT_PORT})
  --host <addr>       Bind address (default: ${DEFAULT_HOST})
  --lan               Bind all interfaces (${DEFAULT_HOST}) for phone/tablet access
  --local-only        Bind loopback only (127.0.0.1)
  --lichii-host <h>   Emulator/Lichii debug RPC host (default: ${DEFAULT_LICHII_HOST})
  --lichii-port <p>   Emulator/Lichii debug RPC port (default: ${DEFAULT_LICHII_PORT})
  --no-browser        Do not auto-open the browser via xdg-open
  --cli, --no-gui     Force terminal CLI mode even when a display server is available
  --gui               Force local GUI launcher window
  --setup-sync        Write EDEN_NX2_DEBUG_SERVER=<host>:<port> to existing
                      ~/.config/{lichii,fritchii,cheezyemu}/nx2_switches.txt and
                      ~/.local/share/{lichii,fritchii}/nx2_switches.txt and exit
  --help, -h          Show this help message
`)
}

export function parsePort(raw, fallback, allowZero = false) {
  const trimmed = String(raw ?? '').trim()
  if (!/^\d+$/.test(trimmed)) return fallback
  const n = Number.parseInt(trimmed, 10)
  const min = allowZero ? 0 : 1
  return Number.isInteger(n) && n >= min && n <= 65535 ? n : fallback
}

export function parseArgs(argv, env = process.env) {
  const opts = {
    host: env.HOST?.trim() || DEFAULT_HOST,
    port: parsePort(env.PORT, DEFAULT_PORT, true),
    lichiiHost: env.LICHII_HOST?.trim() || env.FRITCHII_HOST?.trim() || DEFAULT_LICHII_HOST,
    lichiiPort: parsePort(env.LICHII_PORT || env.FRITCHII_PORT, DEFAULT_LICHII_PORT, false),
    noBrowser: false,
    cli: false,
    noGui: false,
    gui: false,
    setupSync: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? ''
    const eqIdx = arg.indexOf('=')
    const key = eqIdx > 0 ? arg.slice(0, eqIdx) : arg
    const inlineVal = eqIdx > 0 ? arg.slice(eqIdx + 1) : undefined

    if (key === '--help' || key === '-h') {
      opts.help = true
    } else if (key === '--lan') {
      opts.host = DEFAULT_HOST
    } else if (key === '--local-only' || key === '--localhost') {
      opts.host = '127.0.0.1'
    } else if (key === '--no-browser') {
      opts.noBrowser = true
    } else if (key === '--cli') {
      opts.cli = true
    } else if (key === '--no-gui') {
      opts.noGui = true
    } else if (key === '--gui') {
      opts.gui = true
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
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  return opts
}

export function isLoopbackHost(host) {
  const normalized = String(host ?? '').trim().toLowerCase()
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

export function isWildcardBindHost(host) {
  const normalized = String(host ?? '').trim().toLowerCase()
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '0:0:0:0:0:0:0:0'
}

export function collectLanUrls(port) {
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

export function probeTcpPort(host, port, timeoutMs = 200) {
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

export function updateNx2SwitchFile(configPath, newLine) {
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

export function setupSync(lichiiHost = DEFAULT_LICHII_HOST, lichiiPort = DEFAULT_LICHII_PORT) {
  const home = os.homedir()
  const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config')
  const dataHome = process.env.XDG_DATA_HOME?.trim() || path.join(home, '.local', 'share')
  const target = `${lichiiHost}:${lichiiPort}`
  const newLine = `EDEN_NX2_DEBUG_SERVER=${target}`

  const candidates = [
    path.join(configHome, 'lichii', 'nx2_switches.txt'),
    path.join(configHome, 'fritchii', 'nx2_switches.txt'),
    path.join(configHome, 'cheezyemu', 'nx2_switches.txt'),
    path.join(dataHome, 'lichii', 'nx2_switches.txt'),
    path.join(dataHome, 'fritchii', 'nx2_switches.txt'),
  ]

  const updated = []
  for (const cfgPath of candidates) {
    const profileDir = path.dirname(cfgPath)
    if (fs.existsSync(profileDir)) {
      updateNx2SwitchFile(cfgPath, newLine)
      updated.push(cfgPath)
    }
  }

  return { updated, checked: candidates, line: newLine, target }
}

export function runSetupSync(lichiiHost, lichiiPort) {
  const result = setupSync(lichiiHost, lichiiPort)

  printBanner()
  if (result.updated.length === 0) {
    console.log('No existing Lichii, Fritchii, or CheezyEmu profile directory was found.')
    console.log('Checked:')
    for (const cfgPath of result.checked) {
      console.log(`  - ${path.dirname(cfgPath)}`)
    }
    console.log(`Launch your emulator once or create the profile directory, then add:`)
    console.log(`  ${result.line}`)
    return result
  }

  console.log(`Configured ${result.line} in:`)
  for (const cfgPath of result.updated) {
    console.log(`  - ${cfgPath}`)
  }
  console.log('Restart your emulator for the debug RPC switch to take effect.')
  return result
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

function normalizeRecompProcessName(rawName, isComm = false) {
  return normalizeProcessName(rawName, RECOMP_PROCESS_NAMES, isComm)
}

function resolveUserSaveDirFromExe(exePath) {
  if (!exePath) return null
  const exeDir = path.dirname(exePath)
  const leaf = path.basename(exeDir).toLowerCase()
  const gameRoot = leaf === 'bin' ? path.dirname(exeDir) : exeDir
  if (!gameRoot) return null
  const userDir = path.join(gameRoot, 'user')
  return fs.existsSync(userDir) ? userDir : null
}

export function readYamaPtraceScope() {
  try {
    const raw = fs.readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'utf8').trim()
    if (!/^\d+$/.test(raw)) return null
    return Number.parseInt(raw, 10)
  } catch {
    return null
  }
}

export function scanRunningRecompProcess() {
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
    let cmdArgv0 = ''
    try {
      const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8')
      matchedName = normalizeRecompProcessName(comm, true)
    } catch {
      // Ignore exited/inaccessible process
    }

    try {
      const rawCmd = fs.readFileSync(`/proc/${pid}/cmdline`)
      const nul = rawCmd.indexOf(0)
      cmdArgv0 = (nul >= 0 ? rawCmd.subarray(0, nul) : rawCmd).toString('utf8')
      if (!matchedName) {
        matchedName = normalizeRecompProcessName(cmdArgv0, false)
      }
    } catch {
      // Ignore
    }

    let exePath = ''
    try {
      exePath = fs.readlinkSync(`/proc/${pid}/exe`)
      if (!matchedName) {
        matchedName = normalizeRecompProcessName(exePath, false)
      }
    } catch {
      // Ignore
    }

    if (!matchedName) continue

    try {
      const maps = fs.readFileSync(`/proc/${pid}/maps`, 'utf8')
      let hasGuestCode = false
      for (const line of maps.split('\n')) {
        const match = /^([0-9a-f]+)-([0-9a-f]+)\s+([r-])/i.exec(line)
        if (!match || match[3] !== 'r') continue
        const start = BigInt(`0x${match[1]}`)
        const end = BigInt(`0x${match[2]}`)
        if (start <= 0x100080000000n && end >= 0x100080000008n) {
          hasGuestCode = true
          break
        }
      }
      if (!hasGuestCode) continue
    } catch {
      continue
    }

    let saveDir = resolveUserSaveDirFromExe(exePath)
    if (!saveDir && /^[zZ]:[\\/]/.test(cmdArgv0)) {
      const unixCmdExe = cmdArgv0.slice(2).replace(/\\/g, '/')
      saveDir = resolveUserSaveDirFromExe(unixCmdExe)
    }

    return { pid, name: matchedName, saveDir }
  }

  return null
}

// Returns the profile folder of a running NX2Saria (saves in <profile>/save/<uid>/slot_*): NX2SARIA_PROFILE_DIR
// from its environment, resolved against the executable's folder, else the profile folder beside the executable.
export function detectNx2SariaProfileDir() {
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

export function detectLinuxRuntime() {
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
      try {
        const rawCmd = fs.readFileSync(`/proc/${pid}/cmdline`)
        const nul = rawCmd.indexOf(0)
        const cmdArgv0 = (nul >= 0 ? rawCmd.subarray(0, nul) : rawCmd).toString('utf8')
        matchedName = normalizeProcessName(cmdArgv0, EMULATOR_PROCESS_NAMES, false)
      } catch {
        // Ignore
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

export function detectRecompSaveDir(runningTarget) {
  if (runningTarget?.saveDir && fs.existsSync(runningTarget.saveDir)) {
    return runningTarget.saveDir
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

export function resolveRuntimePaths() {
  const bundleRoot = path.resolve(__dirname, '..')
  const packagedServer = path.join(__dirname, 'standalone-server.mjs')
  const packagedDist = path.join(__dirname, 'dist')
  const repoServer = path.resolve(bundleRoot, 'dist', 'standalone-server.mjs')
  const repoDist = path.resolve(bundleRoot, 'dist')

  const serverEntry = fs.existsSync(packagedServer) ? packagedServer : repoServer
  const distDir = fs.existsSync(packagedDist) ? packagedDist : repoDist
  const bridgeBin = path.join(bundleRoot, 'runtime', 'longshot-rpc-bridge')

  return { bundleRoot, serverEntry, distDir, bridgeBin }
}

export function openBrowserLinux(url) {
  try {
    const child = spawn('xdg-open', [url], {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Ignore when headless / xdg-open unavailable
  }
}

export function terminateChild(child, timeoutMs = 2000) {
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

export async function startBridgeIfNeeded({
  lichiiHost,
  lichiiPort,
  bridgeBin,
  currentChild = null,
  onLog = null,
  onExit = null,
  warnedState = { warned: false },
}) {
  if (!isLoopbackHost(lichiiHost) || !bridgeBin || !fs.existsSync(bridgeBin)) {
    return currentChild
  }
  if (currentChild && currentChild.exitCode === null && currentChild.signalCode === null) {
    return currentChild
  }

  const portBusy = await probeTcpPort('127.0.0.1', lichiiPort, 150)
  if (portBusy) return null

  const target = scanRunningRecompProcess()
  if (!target) return null

  const emit = (level, msg) => {
    if (onLog) onLog(level, msg)
    else if (level === 'warn') console.warn(msg)
    else if (level === 'error') console.error(msg)
    else console.log(msg)
  }

  if (!warnedState.warned) {
    const ptraceScope = readYamaPtraceScope()
    if (ptraceScope !== null && ptraceScope !== 0) {
      warnedState.warned = true
      emit(
        'warn',
        `[bridge] Warning: /proc/sys/kernel/yama/ptrace_scope is ${ptraceScope} while ${target.name} (PID ${target.pid}) is running.`,
      )
      emit('warn', '[bridge] Read-only live memory telemetry may fail with EPERM. To allow it:')
      emit('warn', '[bridge]   sudo sysctl kernel.yama.ptrace_scope=0')
      emit('warn', `[bridge] Or grant cap_sys_ptrace: sudo setcap cap_sys_ptrace=eip "${bridgeBin}"`)
    }
  }

  const child = spawn(bridgeBin, ['--port', String(lichiiPort), '--once'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  emit(
    'info',
    `[bridge] Starting read-only Longshot RPC bridge on 127.0.0.1:${lichiiPort} (PID ${target.pid}, ${target.name}).`,
  )

  const forwardBridgeStream = (stream, isErr) => {
    if (!stream) return
    const rl = readline.createInterface({ input: stream })
    rl.on('line', (line) => {
      if (line.trim()) {
        emit(isErr ? 'error' : 'info', `[bridge] ${line}`)
      }
    })
  }
  forwardBridgeStream(child.stdout, false)
  forwardBridgeStream(child.stderr, true)

  child.once('exit', (code, signal) => {
    if (onExit) onExit(child, code, signal)
  })
  child.once('error', (err) => {
    emit('error', `[bridge] Failed to start: ${err.message}`)
    if (onExit) onExit(child, 1, null)
  })

  return child
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2), process.env)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    console.error('Run with --help for usage.')
    process.exit(2)
  }

  if (opts.help) {
    printHelp()
    process.exit(0)
  }

  if (opts.setupSync) {
    runSetupSync(opts.lichiiHost, opts.lichiiPort)
    process.exit(0)
  }

  const hasDisplay = Boolean(process.env.DISPLAY?.trim() || process.env.WAYLAND_DISPLAY?.trim())
  const shouldLaunchGui =
    opts.gui ||
    (hasDisplay && !opts.noBrowser && !opts.cli && !opts.noGui && !opts.setupSync && !opts.help)

  if (shouldLaunchGui) {
    const guiPath = path.join(__dirname, 'ocarina-atlas-gui.mjs')
    if (fs.existsSync(guiPath)) {
      const { startGuiLauncher } = await import('./ocarina-atlas-gui.mjs')
      await startGuiLauncher(opts)
      return
    }
  }

  const paths = resolveRuntimePaths()
  if (!fs.existsSync(paths.serverEntry)) {
    console.error(`FATAL: Missing standalone server at ${paths.serverEntry}`)
    process.exit(1)
  }
  if (!fs.existsSync(path.join(paths.distDir, 'client')) ||
      !fs.existsSync(path.join(paths.distDir, 'server', 'server.js'))) {
    console.error(`FATAL: Missing built dist/client or dist/server under ${paths.distDir}`)
    process.exit(1)
  }

  printBanner()

  const runningTarget = scanRunningRecompProcess()
  const detectedSaveDir = process.env.LONGSHOT_SAVE_DIR?.trim() || detectRecompSaveDir(runningTarget)
  const nx2sariaSaveDir = process.env.NX2SARIA_SAVE_DIR?.trim() || detectNx2SariaProfileDir()

  let bridgeChild = null
  let shuttingDown = false
  let bridgePollInFlight = false
  const warnedState = { warned: false }

  async function manageLongshotBridge() {
    if (shuttingDown || bridgePollInFlight) return
    bridgePollInFlight = true
    try {
      bridgeChild = await startBridgeIfNeeded({
        lichiiHost: opts.lichiiHost,
        lichiiPort: opts.lichiiPort,
        bridgeBin: paths.bridgeBin,
        currentChild: bridgeChild,
        warnedState,
        onExit: (child, code, signal) => {
          if (bridgeChild === child) {
            bridgeChild = null
          }
          if (!shuttingDown && code !== 0 && code !== null) {
            console.log(`[bridge] Exited with code ${code}${signal ? ` (${signal})` : ''}.`)
          }
        },
      })
    } finally {
      bridgePollInFlight = false
    }
  }

  await manageLongshotBridge()
  const bridgeTimer = setInterval(() => {
    void manageLongshotBridge()
  }, 2000)
  bridgeTimer.unref()

  const serverEnv = {
    ...process.env,
    HOST: opts.host,
    PORT: String(opts.port),
    LICHII_HOST: opts.lichiiHost,
    LICHII_PORT: String(opts.lichiiPort),
    APP_DIST_DIR: paths.distDir,
  }
  if (detectedSaveDir && !serverEnv.LONGSHOT_SAVE_DIR) {
    serverEnv.LONGSHOT_SAVE_DIR = detectedSaveDir
  }
  if (nx2sariaSaveDir && !serverEnv.NX2SARIA_SAVE_DIR) {
    serverEnv.NX2SARIA_SAVE_DIR = nx2sariaSaveDir
  }

  const serverChild = spawn(
    process.execPath,
    [paths.serverEntry, '--host', opts.host, '--port', String(opts.port)],
    {
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let readyPrinted = false
  let exitCode = 0

  async function shutdown(reasonSignal, targetCode = 0) {
    if (shuttingDown) return
    shuttingDown = true
    exitCode = targetCode
    clearInterval(bridgeTimer)
    console.log(`\nShutting down Ocarina Atlas (${reasonSignal})...`)
    await Promise.all([
      terminateChild(serverChild, 2500),
      terminateChild(bridgeChild, 1500),
    ])
    process.exit(exitCode)
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT', 0)
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM', 0)
  })
  process.on('SIGHUP', () => {
    void shutdown('SIGHUP', 0)
  })

  const stdoutRl = readline.createInterface({ input: serverChild.stdout })
  stdoutRl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return

    if (trimmed.startsWith('READY ') && !readyPrinted) {
      readyPrinted = true
      const localUrl = trimmed.slice('READY '.length).trim()
      let boundPort = opts.port
      try {
        boundPort = Number.parseInt(new URL(localUrl).port, 10) || opts.port
      } catch {
        // Ignore
      }
      console.log(`Local URL : ${localUrl}`)
      if (isWildcardBindHost(opts.host)) {
        const lanUrls = collectLanUrls(boundPort)
        if (lanUrls.length > 0) {
          for (const item of lanUrls) {
            console.log(`LAN URL   : ${item.url} (${item.interfaceName})`)
          }
        } else {
          console.log('LAN URL   : (no non-virtual IPv4 LAN interface detected)')
        }
      } else {
        console.log(`Bind Host : ${opts.host}`)
      }
      console.log(`Debug RPC : ${opts.lichiiHost}:${opts.lichiiPort}`)
      if (detectedSaveDir) {
        console.log(`Save Dir  : ${detectedSaveDir}`)
      }
      if (nx2sariaSaveDir) {
        console.log(`Save Dir  : ${nx2sariaSaveDir} (NX2Saria)`)
      }
      console.log('Press Ctrl+C to stop.')

      if (!opts.noBrowser) {
        openBrowserLinux(localUrl)
      }
      return
    }

    if (trimmed.startsWith('LAN ')) {
      return
    }

    console.log(`[server] ${trimmed}`)
  })

  const stderrRl = readline.createInterface({ input: serverChild.stderr })
  stderrRl.on('line', (line) => {
    if (line.trim()) {
      console.error(`[server:err] ${line}`)
    }
  })

  serverChild.once('error', (err) => {
    console.error(`FATAL: Failed to spawn standalone server: ${err.message}`)
    void shutdown('spawn-error', 1)
  })

  serverChild.once('exit', (code, signal) => {
    if (shuttingDown) return
    const finalCode = typeof code === 'number' ? code : signal ? 1 : 0
    void shutdown(signal ? `server-${signal}` : `server-exit-${finalCode}`, finalCode)
  })
}

function isDirectEntry() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)
  } catch {
    return path.resolve(process.argv[1]) === __filename
  }
}

if (isDirectEntry()) {
  void main()
}
