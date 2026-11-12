import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

const RELEASE_DIR = path.join(ROOT_DIR, 'release')
const BUNDLE_FOLDER_NAME = 'HyruleAtlas-Windows-x64'
const BUNDLE_DIR = path.join(RELEASE_DIR, BUNDLE_FOLDER_NAME)
const ZIP_NAME = 'HyruleAtlas-Windows-x64.zip'
const ZIP_PATH = path.join(RELEASE_DIR, ZIP_NAME)

const DIST_DIR = path.join(ROOT_DIR, 'dist')
const STANDALONE_ENTRY = path.join(ROOT_DIR, 'scripts', 'server-entry.ts')
const STANDALONE_OUT = path.join(DIST_DIR, 'standalone-server.mjs')
const LAUNCHER_CS = path.join(ROOT_DIR, 'launcher', 'HyruleAtlas.cs')
const LAUNCHER_EXE = path.join(BUNDLE_DIR, 'HyruleAtlas.exe')

function runStep(label, command, args, options = {}) {
  console.log(`\n==> ${label}`)
  execFileSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    ...options,
  })
}

function findCscExe() {
  const winDir = process.env.WINDIR || 'C:\\Windows'
  const netRoots = [
    path.join(winDir, 'Microsoft.NET', 'Framework64'),
    path.join(winDir, 'Microsoft.NET', 'Framework'),
  ]

  for (const root of netRoots) {
    if (!fs.existsSync(root)) continue
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^v4/i.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

    for (const versionDir of entries) {
      const candidate = path.join(root, versionDir, 'csc.exe')
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }

  throw new Error(
    'Could not locate .NET Framework 4.x csc.exe under %WINDIR%\\Microsoft.NET\\Framework64\\v4*',
  )
}

function assertExists(targetPath, description) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing expected ${description}: ${targetPath}`)
  }
}

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function main() {
  if (process.platform !== 'win32') {
    throw new Error('scripts/build-win.mjs must be run on Windows (requires .NET csc.exe and Windows node.exe).')
  }

  const viteCli = path.join(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js')
  const rolldownCli = path.join(ROOT_DIR, 'node_modules', 'rolldown', 'bin', 'cli.mjs')
  assertExists(viteCli, 'Vite CLI')
  assertExists(rolldownCli, 'Rolldown CLI')
  assertExists(STANDALONE_ENTRY, 'standalone server entry')
  assertExists(LAUNCHER_CS, 'WinForms launcher source')

  // 1. Build Vite client + SSR bundle into dist/
  runStep('Building Vite client + SSR app (dist/)', process.execPath, [viteCli, 'build'])

  // 2. Bundle standalone Node HTTP server into dist/standalone-server.mjs (zero node_modules at runtime)
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

  const distClient = path.join(DIST_DIR, 'client')
  const distServer = path.join(DIST_DIR, 'server')
  assertExists(STANDALONE_OUT, 'standalone server bundle')
  assertExists(distClient, 'dist/client directory')
  assertExists(path.join(distServer, 'server.js'), 'dist/server/server.js')
  assertExists(path.join(distServer, 'package.json'), 'dist/server/package.json')

  // 3. Stage portable Windows bundle directory
  console.log(`\n==> Staging portable release directory: ${BUNDLE_DIR}`)
  fs.rmSync(BUNDLE_DIR, { recursive: true, force: true })
  fs.rmSync(ZIP_PATH, { force: true })

  const runtimeDir = path.join(BUNDLE_DIR, 'runtime')
  const appDir = path.join(BUNDLE_DIR, 'app')
  const appDistDir = path.join(appDir, 'dist')

  fs.mkdirSync(runtimeDir, { recursive: true })
  fs.mkdirSync(appDistDir, { recursive: true })

  fs.copyFileSync(STANDALONE_OUT, path.join(appDir, 'standalone-server.mjs'))
  fs.cpSync(distClient, path.join(appDistDir, 'client'), { recursive: true })
  fs.cpSync(distServer, path.join(appDistDir, 'server'), { recursive: true })

  for (const docName of ['LICENSE', 'README.md']) {
    const srcDoc = path.join(ROOT_DIR, docName)
    if (fs.existsSync(srcDoc)) {
      fs.copyFileSync(srcDoc, path.join(BUNDLE_DIR, docName))
    }
  }

  // 4. Copy current Node.js executable as portable runtime/node.exe
  assertExists(process.execPath, 'Node.js runtime binary')
  const bundledNodePath = path.join(runtimeDir, 'node.exe')
  fs.copyFileSync(process.execPath, bundledNodePath)
  console.log(`Copied Node.js runtime (${process.version}): ${bundledNodePath}`)

  // 5. Compile native Windows launcher GUI (HyruleAtlas.exe)
  const cscExe = findCscExe()
  runStep(`Compiling WinForms launcher with ${cscExe}`, cscExe, [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:x64',
    '/warn:4',
    '/warnaserror',
    `/out:${LAUNCHER_EXE}`,
    LAUNCHER_CS,
  ])
  assertExists(LAUNCHER_EXE, 'compiled HyruleAtlas.exe')

  // 6. Create portable ZIP archive for GitHub Releases
  const psCommand = [
    '$ErrorActionPreference = "Stop"',
    `Compress-Archive -Path "${BUNDLE_DIR}" -DestinationPath "${ZIP_PATH}" -CompressionLevel Optimal -Force`,
  ].join('; ')

  runStep(`Creating portable ZIP archive (${ZIP_NAME})`, 'powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    psCommand,
  ])
  assertExists(ZIP_PATH, 'portable ZIP archive')

  const exeStat = fs.statSync(LAUNCHER_EXE)
  const nodeStat = fs.statSync(bundledNodePath)
  const zipStat = fs.statSync(ZIP_PATH)

  console.log('\nBuild completed successfully:')
  console.log(`  Launcher : ${LAUNCHER_EXE} (${formatMb(exeStat.size)})`)
  console.log(`  Runtime  : ${bundledNodePath} (${formatMb(nodeStat.size)})`)
  console.log(`  App Dir  : ${appDir}`)
  console.log(`  ZIP File : ${ZIP_PATH} (${formatMb(zipStat.size)})`)
}

main()
