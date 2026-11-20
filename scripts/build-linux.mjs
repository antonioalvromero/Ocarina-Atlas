import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

const RELEASE_DIR = path.join(ROOT_DIR, 'release')
const STAGE_DIR = path.join(ROOT_DIR, 'dist-linux-app')
const APPIMAGE_NAME = 'OcarinaAtlas-Linux-x64.AppImage'
const APPIMAGE_PATH = path.join(RELEASE_DIR, APPIMAGE_NAME)

const DIST_DIR = path.join(ROOT_DIR, 'dist')
const STANDALONE_ENTRY = path.join(ROOT_DIR, 'scripts', 'server-entry.ts')
const STANDALONE_OUT = path.join(DIST_DIR, 'standalone-server.mjs')

const APPIMAGE_SRC_DIR = path.join(ROOT_DIR, 'launcher', 'linux-appimage')
const BRIDGE_C_SRC = path.join(ROOT_DIR, 'launcher', 'linux', 'longshot_rpc_bridge.c')
const LINUX_ICON_CANDIDATES = [
  path.join(ROOT_DIR, 'public', 'icons', 'icon-512.png'),
  path.join(ROOT_DIR, 'public', 'apple-touch-icon.png'),
  path.join(ROOT_DIR, 'public', 'icons', 'apple-touch-icon.png'),
]

function parseBuildArgs(argv) {
  const opts = {
    skipBuild: false,
    skipNative: false,
    skipAppImage: false,
  }
  for (const arg of argv) {
    if (arg === '--skip-build') opts.skipBuild = true
    else if (arg === '--skip-native') opts.skipNative = true
    else if (arg === '--skip-appimage') opts.skipAppImage = true
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/build-linux.mjs [--skip-build] [--skip-native] [--skip-appimage]',
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

function normalizeSemver(rawVersion) {
  const cleaned = String(rawVersion || '').trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(cleaned)
  if (!match) {
    return '0.0.0'
  }
  const base = `${match[1]}.${match[2]}.${match[3]}`
  if (!match[4]) return base
  const prerelease = match[4]
    .split('.')
    .map((part) => part.replace(/[^0-9A-Za-z-]/g, ''))
    .filter(Boolean)
    .join('.')
  return prerelease ? `${base}-${prerelease}` : base
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function copyTextLf(srcPath, destPath) {
  const content = fs.readFileSync(srcPath, 'utf8').replace(/\r\n/g, '\n')
  fs.writeFileSync(destPath, content, 'utf8')
}

function ensureLinuxPackagerDeps() {
  const localBuilderDir = path.join(APPIMAGE_SRC_DIR, 'node_modules', 'electron-builder')
  const rootBuilderDir = path.join(ROOT_DIR, 'node_modules', 'electron-builder')
  if (fs.existsSync(localBuilderDir) || fs.existsSync(rootBuilderDir)) {
    return
  }
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  runStep(
    'Installing Linux AppImage packager dependencies (launcher/linux-appimage)',
    npmCmd,
    ['install', '--no-audit', '--no-fund'],
    { cwd: APPIMAGE_SRC_DIR },
  )
}

function resolveElectronVersion() {
  const candidates = [
    path.join(APPIMAGE_SRC_DIR, 'node_modules', 'electron', 'package.json'),
    path.join(ROOT_DIR, 'node_modules', 'electron', 'package.json'),
  ]
  for (const pkgPath of candidates) {
    if (fs.existsSync(pkgPath)) {
      const pkg = readJson(pkgPath)
      if (pkg && typeof pkg.version === 'string' && pkg.version.trim()) {
        return normalizeSemver(pkg.version)
      }
    }
  }
  const packagerPkgPath = path.join(APPIMAGE_SRC_DIR, 'package.json')
  if (fs.existsSync(packagerPkgPath)) {
    const packagerPkg = readJson(packagerPkgPath)
    const rawRange = packagerPkg?.devDependencies?.electron
    if (typeof rawRange === 'string') {
      return normalizeSemver(rawRange.replace(/^[\^~>=<]+/, ''))
    }
  }
  throw new Error(
    'Unable to resolve Electron version from launcher/linux-appimage or root node_modules',
  )
}

function resolveElectronBuilderBin() {
  const binName = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
  const candidates = [
    path.join(APPIMAGE_SRC_DIR, 'node_modules', '.bin', binName),
    path.join(APPIMAGE_SRC_DIR, 'node_modules', '.bin', 'electron-builder'),
    path.join(APPIMAGE_SRC_DIR, 'node_modules', 'electron-builder', 'cli.js'),
    path.join(ROOT_DIR, 'node_modules', '.bin', binName),
    path.join(ROOT_DIR, 'node_modules', '.bin', 'electron-builder'),
    path.join(ROOT_DIR, 'node_modules', 'electron-builder', 'cli.js'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(
    `Missing electron-builder CLI in ${path.join(APPIMAGE_SRC_DIR, 'node_modules', '.bin', 'electron-builder')} or root node_modules`,
  )
}

function main() {
  const opts = parseBuildArgs(process.argv.slice(2))

  const mainSrc = path.join(APPIMAGE_SRC_DIR, 'main.cjs')
  const preloadSrc = path.join(APPIMAGE_SRC_DIR, 'preload.cjs')
  const htmlSrc = path.join(APPIMAGE_SRC_DIR, 'index.html')

  assertExists(mainSrc, 'Electron main process entry')
  assertExists(preloadSrc, 'Electron preload script')
  assertExists(htmlSrc, 'Electron launcher HTML')
  assertExists(BRIDGE_C_SRC, 'Linux Longshot RPC bridge C source')

  if (!opts.skipAppImage) {
    ensureLinuxPackagerDeps()
  }

  const rootPkg = readJson(path.join(ROOT_DIR, 'package.json'))
  const electronVersion = resolveElectronVersion()

  const normalizedVersion = normalizeSemver(rootPkg.version)

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

  console.log(`\n==> Staging Linux AppImage directory: ${STAGE_DIR}`)
  fs.rmSync(STAGE_DIR, { recursive: true, force: true })
  fs.mkdirSync(RELEASE_DIR, { recursive: true })
  fs.rmSync(APPIMAGE_PATH, { force: true })

  const appDir = path.join(STAGE_DIR, 'app')
  const appDistDir = path.join(appDir, 'dist')
  const binDir = path.join(STAGE_DIR, 'bin')
  const buildDir = path.join(STAGE_DIR, 'build')

  fs.mkdirSync(appDistDir, { recursive: true })
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(buildDir, { recursive: true })

  // Electron app shell files (CRLF -> LF)
  copyTextLf(mainSrc, path.join(STAGE_DIR, 'main.cjs'))
  copyTextLf(preloadSrc, path.join(STAGE_DIR, 'preload.cjs'))
  copyTextLf(htmlSrc, path.join(STAGE_DIR, 'index.html'))

  // Bundled standalone server & Vite client/SSR artifacts
  fs.copyFileSync(STANDALONE_OUT, path.join(appDir, 'standalone-server.mjs'))
  fs.cpSync(distClient, path.join(appDistDir, 'client'), { recursive: true })
  fs.cpSync(distServer, path.join(appDistDir, 'server'), { recursive: true })

  // Icon
  const iconSrc = LINUX_ICON_CANDIDATES.find((candidate) => fs.existsSync(candidate))
  if (!iconSrc) {
    throw new Error('No Linux application icon found in public/icons/icon-512.png or public/apple-touch-icon.png')
  }
  fs.copyFileSync(iconSrc, path.join(buildDir, 'icon.png'))

  // License
  const licenseSrc = path.join(ROOT_DIR, 'LICENSE')
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(STAGE_DIR, 'LICENSE'))
  }

  // Compile longshot-rpc-bridge C utility
  const bridgeOutPath = path.join(binDir, 'longshot-rpc-bridge')
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
    assertExists(bridgeOutPath, 'compiled bin/longshot-rpc-bridge')
    fs.chmodSync(bridgeOutPath, 0o755)
  } else {
    console.warn(
      `WARN: Skipping native gcc compilation of longshot_rpc_bridge.c on ${process.platform} (run on Linux x64 for full binary).`,
    )
  }

  // Stage minimal package.json with electron-builder config
  const stagedPkg = {
    name: 'ocarina-atlas',
    version: normalizedVersion,
    description: 'Interactive Ocarina of Time Remake map & live telemetry launcher',
    main: 'main.cjs',
    license: 'AGPL-3.0',
    author: 'antonioalvromero',
    build: {
      appId: 'io.github.antonioalvromero.ocarinaatlas',
      productName: 'Ocarina Atlas',
      electronVersion,
      directories: {
        buildResources: 'build',
        output: '../release',
      },
      files: ['main.cjs', 'preload.cjs', 'index.html', 'package.json'],
      extraResources: [
        { from: 'app', to: 'app' },
        { from: 'bin', to: 'bin' },
        { from: 'build/icon.png', to: 'build/icon.png' },
      ],
      linux: {
        target: ['AppImage'],
        category: 'Game',
        icon: 'build/icon.png',
        executableName: 'ocarina-atlas',
        maintainer: 'antonioalvromero',
        artifactName: APPIMAGE_NAME,
      },
      appImage: {
        artifactName: APPIMAGE_NAME,
      },
    },
  }
  fs.writeFileSync(
    path.join(STAGE_DIR, 'package.json'),
    `${JSON.stringify(stagedPkg, null, 2)}\n`,
    'utf8',
  )

  if (!opts.skipAppImage) {
    ensureLinuxPackagerDeps()
    const electronBuilderBin = resolveElectronBuilderBin()
    const builderArgs = ['--linux', 'AppImage', '--x64', '--projectDir', STAGE_DIR]
    if (
      electronBuilderBin.endsWith('.js') ||
      electronBuilderBin.endsWith('.cjs') ||
      electronBuilderBin.endsWith('.mjs')
    ) {
      runStep(
        `Packaging Linux x64 AppImage (${APPIMAGE_NAME})`,
        process.execPath,
        [electronBuilderBin, ...builderArgs],
      )
    } else {
      runStep(
        `Packaging Linux x64 AppImage (${APPIMAGE_NAME})`,
        electronBuilderBin,
        builderArgs,
      )
    }
    assertExists(APPIMAGE_PATH, 'Linux x64 AppImage')
    fs.chmodSync(APPIMAGE_PATH, 0o755)
  }

  console.log('\nLinux AppImage build completed:')
  console.log(`  Staged   : ${STAGE_DIR} (v${normalizedVersion})`)
  if (fs.existsSync(bridgeOutPath)) {
    console.log(`  Bridge   : ${bridgeOutPath} (${formatMb(fs.statSync(bridgeOutPath).size)})`)
  }
  if (fs.existsSync(APPIMAGE_PATH)) {
    console.log(`  AppImage : ${APPIMAGE_PATH} (${formatMb(fs.statSync(APPIMAGE_PATH).size)})`)
  }
}

main()
