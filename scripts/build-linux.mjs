import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

const RELEASE_DIR = path.join(ROOT_DIR, 'release')
const BUNDLE_FOLDER_NAME = 'OcarinaAtlas-Linux-x64'
const BUNDLE_DIR = path.join(RELEASE_DIR, BUNDLE_FOLDER_NAME)
const TAR_NAME = 'OcarinaAtlas-Linux-x64.tar.gz'
const TAR_PATH = path.join(RELEASE_DIR, TAR_NAME)

const DIST_DIR = path.join(ROOT_DIR, 'dist')
const STANDALONE_ENTRY = path.join(ROOT_DIR, 'scripts', 'server-entry.ts')
const STANDALONE_OUT = path.join(DIST_DIR, 'standalone-server.mjs')
const LINUX_WRAPPER_SRC = path.join(ROOT_DIR, 'launcher', 'linux', 'OcarinaAtlas')
const LINUX_CLI_SRC = path.join(ROOT_DIR, 'launcher', 'linux', 'ocarina-atlas-cli.mjs')
const BRIDGE_C_SRC = path.join(ROOT_DIR, 'launcher', 'linux', 'longshot_rpc_bridge.c')

function parseBuildArgs(argv) {
  const opts = {
    skipBuild: false,
    skipNative: false,
    skipTar: false,
  }
  for (const arg of argv) {
    if (arg === '--skip-build') opts.skipBuild = true
    else if (arg === '--skip-native') opts.skipNative = true
    else if (arg === '--skip-tar') opts.skipTar = true
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/build-linux.mjs [--skip-build] [--skip-native] [--skip-tar]',
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }
  return opts
}

function runStep(label, command, args, options = {}) {
  console.log(`\n==> ${label}`)
  execFileSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    ...options,
  })
}

function assertExists(targetPath, description) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing expected ${description}: ${targetPath}`)
  }
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function findCommand(cmd) {
  const pathEnv = process.env.PATH || ''
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue
    const candidate = path.join(dir, cmd)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function buildReadmeLinux() {
  return [
    'Ocarina Atlas — Linux x64 (Pre-release / Experimental)',
    '====================================================',
    '',
    'Official Repository: https://github.com/antonioalvromero/Ocarina-Atlas',
    'License: GNU AGPL-3.0 (see LICENSE)',
    '',
    'Quick Start',
    '-----------',
    '  ./OcarinaAtlas',
    '',
    'Common Options',
    '--------------',
    '  --port <n>          HTTP port (default: 3000)',
    '  --local-only        Bind 127.0.0.1 instead of LAN (0.0.0.0)',
    '  --lichii-host <h>   Debug RPC host (default: 127.0.0.1)',
    '  --lichii-port <p>   Debug RPC port (default: 6545)',
    '  --no-browser        Do not auto-open browser via xdg-open',
    '  --setup-sync        Configure EDEN_NX2_DEBUG_SERVER in existing',
    '                      Lichii/Fritchii/CheezyEmu nx2_switches.txt profiles',
    '  --help              Show all CLI options',
    '',
    'Longshot / Project ReLink / Triforce Telemetry Permissions',
    '----------------------------------------------------------',
    'Ocarina Atlas reads game memory strictly read-only via runtime/longshot-rpc-bridge.',
    'On Linux distributions with Yama ptrace hardening (kernel.yama.ptrace_scope=1),',
    'reading memory of an externally launched game may return EPERM. If prompted:',
    '  - Temporary: sudo sysctl -w kernel.yama.ptrace_scope=0',
    '  - Or cap   : sudo setcap cap_sys_ptrace=eip ./runtime/longshot-rpc-bridge',
    '',
  ].join('\n')
}

function main() {
  const opts = parseBuildArgs(process.argv.slice(2))

  assertExists(LINUX_WRAPPER_SRC, 'Linux wrapper script')
  assertExists(LINUX_CLI_SRC, 'Linux CLI launcher')
  assertExists(BRIDGE_C_SRC, 'Linux Longshot RPC bridge C source')

  if (!opts.skipBuild) {
    const viteCli = path.join(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
    const rolldownCli = path.join(ROOT_DIR, 'node_modules', 'rolldown', 'bin', 'cli.mjs')
    assertExists(viteCli, 'Vite CLI')
    assertExists(rolldownCli, 'Rolldown CLI')
    assertExists(STANDALONE_ENTRY, 'standalone server entry')

    runStep('Building Vite client + SSR app (dist/)', process.execPath, [viteCli, 'build'])
    runStep('Bundling standalone server (dist/standalone-server.mjs)', process.execPath, [
      rolldownCli,
      STANDALONE_ENTRY,
      '--platform',
      'node',
      '--format',
      'esm',
      '--minify',
      '-o',
      STANDALONE_OUT,
    ])
  }

  const distClient = path.join(DIST_DIR, 'client')
  const distServer = path.join(DIST_DIR, 'server')
  assertExists(STANDALONE_OUT, 'standalone server bundle')
  assertExists(distClient, 'dist/client directory')
  assertExists(path.join(distServer, 'server.js'), 'dist/server/server.js')
  assertExists(path.join(distServer, 'package.json'), 'dist/server/package.json')

  console.log(`\n==> Staging portable Linux release directory: ${BUNDLE_DIR}`)
  fs.rmSync(BUNDLE_DIR, { recursive: true, force: true })
  fs.rmSync(TAR_PATH, { force: true })

  const runtimeDir = path.join(BUNDLE_DIR, 'runtime')
  const appDir = path.join(BUNDLE_DIR, 'app')
  const appDistDir = path.join(appDir, 'dist')

  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.mkdirSync(appDistDir, { recursive: true })

  fs.copyFileSync(STANDALONE_OUT, path.join(appDir, 'standalone-server.mjs'))
  fs.cpSync(distClient, path.join(appDistDir, 'client'), { recursive: true })
  fs.cpSync(distServer, path.join(appDistDir, 'server'), { recursive: true })
  fs.copyFileSync(LINUX_CLI_SRC, path.join(appDir, 'ocarina-atlas-cli.mjs'))

  const wrapperDest = path.join(BUNDLE_DIR, 'OcarinaAtlas')
  fs.copyFileSync(LINUX_WRAPPER_SRC, wrapperDest)
  fs.chmodSync(wrapperDest, 0o755)

  for (const docName of ['LICENSE', 'README.md']) {
    const srcDoc = path.join(ROOT_DIR, docName)
    if (fs.existsSync(srcDoc)) {
      fs.copyFileSync(srcDoc, path.join(BUNDLE_DIR, docName))
    }
  }
  fs.writeFileSync(path.join(BUNDLE_DIR, 'README-Linux.txt'), buildReadmeLinux(), 'utf8')

  // Bundle Linux Node.js runtime
  const explicitLinuxNode = process.env.LINUX_NODE_BIN?.trim()
  const bundledNodePath = path.join(runtimeDir, 'node')
  if (explicitLinuxNode) {
    assertExists(explicitLinuxNode, 'LINUX_NODE_BIN')
    fs.copyFileSync(explicitLinuxNode, bundledNodePath)
    fs.chmodSync(bundledNodePath, 0o755)
    console.log(`Copied Linux Node.js runtime from LINUX_NODE_BIN: ${bundledNodePath}`)
  } else if (process.platform === 'linux' && process.arch === 'x64') {
    assertExists(process.execPath, 'Linux Node.js runtime binary')
    fs.copyFileSync(process.execPath, bundledNodePath)
    fs.chmodSync(bundledNodePath, 0o755)
    console.log(`Copied Node.js runtime (${process.version}): ${bundledNodePath}`)
  } else {
    console.warn(
      `WARN: Skipping runtime/node bundle on ${process.platform}-${process.arch} (set LINUX_NODE_BIN to a Linux x64 node binary to bundle cross-platform).`,
    )
  }

  // Compile longshot-rpc-bridge C utility
  const bridgeOutPath = path.join(runtimeDir, 'longshot-rpc-bridge')
  if (opts.skipNative) {
    console.log('Skipping native longshot-rpc-bridge compilation (--skip-native).')
  } else if (process.platform === 'linux') {
    const gccPath = findCommand('gcc')
    if (!gccPath) {
      throw new Error(
        'gcc was not found on PATH. Install gcc (e.g. build-essential) or pass --skip-native.',
      )
    }
    runStep(`Compiling read-only Longshot RPC bridge (${gccPath})`, gccPath, [
      '-O2',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-pthread',
      '-std=c99',
      '-o',
      bridgeOutPath,
      BRIDGE_C_SRC,
    ])
    assertExists(bridgeOutPath, 'compiled runtime/longshot-rpc-bridge')
    fs.chmodSync(bridgeOutPath, 0o755)
  } else {
    console.warn(
      `WARN: Skipping native gcc compilation of longshot_rpc_bridge.c on ${process.platform} (run on Linux x64 for full binary).`,
    )
  }

  if (!opts.skipTar) {
    runStep(`Creating portable tarball (${TAR_NAME})`, 'tar', [
      '-czf',
      TAR_PATH,
      '-C',
      RELEASE_DIR,
      BUNDLE_FOLDER_NAME,
    ])
    assertExists(TAR_PATH, 'portable tar.gz archive')
  }

  console.log('\nLinux build completed:')
  console.log(`  Launcher : ${wrapperDest}`)
  console.log(`  CLI Entry: ${path.join(appDir, 'ocarina-atlas-cli.mjs')}`)
  if (fs.existsSync(bundledNodePath)) {
    console.log(`  Runtime  : ${bundledNodePath} (${formatMb(fs.statSync(bundledNodePath).size)})`)
  }
  if (fs.existsSync(bridgeOutPath)) {
    console.log(`  Bridge   : ${bridgeOutPath} (${formatMb(fs.statSync(bridgeOutPath).size)})`)
  }
  if (fs.existsSync(TAR_PATH)) {
    console.log(`  Archive  : ${TAR_PATH} (${formatMb(fs.statSync(TAR_PATH).size)})`)
  }
}

main()
