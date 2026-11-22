import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { EmulatorKind } from '../lichii-types'
import {
  GHOST_SHOP_COUPON_BOTTLE_ITEM_ID,
  GHOST_SHOP_COUPON_NUM_HASH,
  GHOST_SHOP_COUPON_THRESHOLD,
  KNOWN_BEAN_BOOL_HASH_TO_ITEM_ID,
  KNOWN_BOTTLE_BOOL_HASH_TO_ITEM_ID,
  KNOWN_FAIRY_BOOL_HASH_TO_ITEM_ID,
  KNOWN_HEART_PIECE_BOOL_HASH_TO_ITEM_ID,
  KNOWN_REQUIREMENT_BOOL_HASH_TO_KEY,
  KNOWN_THOUGHT_BOOL_HASH_TO_ITEM_ID,
} from './collectible-hashes'

export const OOT_REMAKE_TITLE_ID = '0400486024DEC000'
export const DEFAULT_EMULATOR_SAVE_ROOTS = ['fritchii', 'lichii', 'eden', 'cheezyemu'] as const
export const DEFAULT_EMULATOR_NAND_SAVE_SUBDIRS = ['0000000000000000', 'account'] as const

const RECOMP_USER_SUBDIRS = [
  ['Longshot'],
  ['Longshot', 'user'],
  ['Longshot', 'LongshotLauncher-data', 'user'],
  ['Hookshot', 'user'],
  ['HeyListen', 'user'],
  ['ProjectReLink', 'user'],
  ['ProjectReLink', 'game', 'user'],
  ['ReLink', 'user'],
  ['ReLink', 'game', 'user'],
  ['Triforce', 'user'],
] as const

function getDefaultRecompSaveDirs(): string[] {
  const home = os.homedir()
  return [
    'E:\\Longshot\\Game\\user',
    ...RECOMP_USER_SUBDIRS.map((parts) => path.join(home, 'Games', ...parts)),
  ]
}

const IGNORED_INSTANCE_TRAVERSAL_DIRS = new Set([
  'node_modules',
  '.git',
  'bin',
  'assets',
  'romfs',
  'exefs',
  'shaders',
  'cache',
  'logs',
  'nand',
  'save',
  'user',
  'profile',
])

function listSubdirsSafe(dirPath: string): string[] {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function listVisibleInstanceSubdirsBounded(dirPath: string, maxEntries = 32): string[] {
  try {
    if (!fs.existsSync(dirPath)) return []
    const result: string[] = []
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const name = entry.name
      if (
        name.startsWith('.') ||
        name.startsWith('slot_') ||
        IGNORED_INSTANCE_TRAVERSAL_DIRS.has(name.toLowerCase())
      ) {
        continue
      }
      result.push(name)
      if (result.length >= maxEntries) break
    }
    return result
  } catch {
    return []
  }
}

/**
 * Scans LongshotLauncher `<track>/<version>/user/save` and `builds/<track>/<version>/user/save`
 * instance layouts under a candidate root directory with bounded depth.
 */
function collectLongshotInstanceSaveRoots(rootDir: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const pushSaveRoot = (candidateSaveDir: string) => {
    const resolved = path.resolve(candidateSaveDir)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (!seen.has(key) && fs.existsSync(resolved)) {
      seen.add(key)
      found.push(resolved)
    }
  }

  const buildsBases = [
    rootDir,
    path.join(rootDir, 'builds'),
    path.join(rootDir, 'LongshotLauncher-data', 'builds'),
  ]
  for (const buildsBase of buildsBases) {
    for (const trackOrVersion of listVisibleInstanceSubdirsBounded(buildsBase)) {
      const trackDir = path.join(buildsBase, trackOrVersion)
      pushSaveRoot(path.join(trackDir, 'user', 'save'))
      pushSaveRoot(path.join(trackDir, 'save'))
      for (const versionDirName of listVisibleInstanceSubdirsBounded(trackDir)) {
        const versionDir = path.join(trackDir, versionDirName)
        pushSaveRoot(path.join(versionDir, 'user', 'save'))
        pushSaveRoot(path.join(versionDir, 'save'))
      }
    }
  }

  return found
}

function parseSteamLibraryFoldersVdf(vdfPath: string): string[] {
  try {
    if (!fs.existsSync(vdfPath)) return []
    const content = fs.readFileSync(vdfPath, 'utf8')
    const libs: string[] = []
    const re = /^\s*"path"\s+"([^"]+)"/gm
    let match: RegExpExecArray | null
    while ((match = re.exec(content)) !== null) {
      const libPath = match[1]?.replace(/\\\\/g, '\\').trim()
      if (libPath) libs.push(libPath)
    }
    return libs
  } catch {
    return []
  }
}

function collectLinuxLauncherLongshotDirs(userDir: string, pushUnique: (dir: string) => void): void {
  const candidates = [
    path.join(userDir, 'AppData', 'Roaming', 'Longshot'),
    path.join(userDir, 'AppData', 'Roaming', 'Longshot', 'user'),
    path.join(userDir, 'AppData', 'Local', 'Programs', 'LongshotLauncher', 'LongshotLauncher-data', 'user'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      pushUnique(dir)
    }
  }
}

function collectWinePrefixSaveDirs(prefixDir: string, pushUnique: (dir: string) => void): void {
  const driveC = path.join(prefixDir, 'drive_c')
  if (!fs.existsSync(driveC)) return

  const usersDir = path.join(driveC, 'users')
  const skipUsers = new Set(['public', 'default', 'default user', 'all users'])
  for (const userName of listSubdirsSafe(usersDir)) {
    if (skipUsers.has(userName.toLowerCase())) continue
    const userDir = path.join(usersDir, userName)
    for (const emu of DEFAULT_EMULATOR_SAVE_ROOTS) {
      for (const saveSub of DEFAULT_EMULATOR_NAND_SAVE_SUBDIRS) {
        const emuSave = path.join(userDir, 'AppData', 'Roaming', emu, 'nand', 'user', 'save', saveSub)
        if (fs.existsSync(emuSave)) {
          pushUnique(emuSave)
        }
      }
    }
    collectLinuxLauncherLongshotDirs(userDir, pushUnique)
    for (const parts of RECOMP_USER_SUBDIRS) {
      const userGamesSave = path.join(userDir, 'Games', ...parts)
      if (fs.existsSync(userGamesSave)) {
        pushUnique(userGamesSave)
      }
    }
  }

  for (const parts of RECOMP_USER_SUBDIRS) {
    const driveCGamesSave = path.join(driveC, 'Games', ...parts)
    if (fs.existsSync(driveCGamesSave)) {
      pushUnique(driveCGamesSave)
    }
  }
}

function collectLinuxContainerSaveDirs(
  env: NodeJS.ProcessEnv,
  xdgDataHome: string,
  pushUnique: (dir: string) => void,
): void {
  const home = os.homedir()
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim() || path.join(home, '.config')

  // 1. Wine prefixes (WINEPREFIX and ~/.wine)
  const winePrefixes = [env.WINEPREFIX?.trim(), path.join(home, '.wine')].filter(
    (p): p is string => Boolean(p),
  )
  for (const prefixDir of winePrefixes) {
    collectWinePrefixSaveDirs(prefixDir, pushUnique)
  }

  // 2. Steam / Proton compatdata prefixes via libraryfolders.vdf
  const steamRoots = [
    path.join(xdgDataHome, 'Steam'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.steam', 'steam'),
    path.join(home, '.steam', 'debian-installation'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
  ]
  const steamLibraries = new Set<string>()
  for (const steamRoot of steamRoots) {
    if (!fs.existsSync(steamRoot)) continue
    steamLibraries.add(path.resolve(steamRoot))
    for (const vdfRel of [
      path.join('steamapps', 'libraryfolders.vdf'),
      path.join('config', 'libraryfolders.vdf'),
    ]) {
      for (const libPath of parseSteamLibraryFoldersVdf(path.join(steamRoot, vdfRel))) {
        steamLibraries.add(path.resolve(libPath))
      }
    }
  }
  for (const libDir of steamLibraries) {
    const compatDataDir = path.join(libDir, 'steamapps', 'compatdata')
    for (const appId of listSubdirsSafe(compatDataDir)) {
      collectWinePrefixSaveDirs(path.join(compatDataDir, appId, 'pfx'), pushUnique)
    }
  }

  // 3. Flatpak (~/.var/app/*/{data,config})
  const flatpakDir = path.join(home, '.var', 'app')
  for (const appId of listSubdirsSafe(flatpakDir)) {
    for (const sub of ['data', 'config'] as const) {
      for (const emu of DEFAULT_EMULATOR_SAVE_ROOTS) {
        for (const saveSub of DEFAULT_EMULATOR_NAND_SAVE_SUBDIRS) {
          const emuSave = path.join(flatpakDir, appId, sub, emu, 'nand', 'user', 'save', saveSub)
          if (fs.existsSync(emuSave)) {
            pushUnique(emuSave)
          }
        }
      }
    }
  }

  // 4. Bottles
  const bottlesRoots = [
    path.join(xdgDataHome, 'bottles', 'bottles'),
    path.join(home, '.local', 'share', 'bottles', 'bottles'),
    path.join(home, '.var', 'app', 'com.usebottles.bottles', 'data', 'bottles', 'bottles'),
  ]
  for (const bottlesRoot of bottlesRoots) {
    for (const bottle of listSubdirsSafe(bottlesRoot)) {
      collectWinePrefixSaveDirs(path.join(bottlesRoot, bottle), pushUnique)
    }
  }

  // 5. Heroic
  const heroicRoots = [
    path.join(home, 'Games', 'Heroic', 'Prefixes'),
    path.join(xdgConfigHome, 'heroic', 'Prefixes'),
    path.join(home, '.config', 'heroic', 'Prefixes'),
    path.join(home, '.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic', 'Prefixes'),
  ]
  for (const heroicRoot of heroicRoots) {
    for (const prefix of listSubdirsSafe(heroicRoot)) {
      const prefixPath = path.join(heroicRoot, prefix)
      collectWinePrefixSaveDirs(prefixPath, pushUnique)
      collectWinePrefixSaveDirs(path.join(prefixPath, 'pfx'), pushUnique)
    }
  }

  // 6. Lutris and custom ~/Games/* directories
  const gamesRoot = path.join(home, 'Games')
  for (const gameDirName of listSubdirsSafe(gamesRoot)) {
    const gameDir = path.join(gamesRoot, gameDirName)
    for (const rel of [['user'], ['game', 'user'], ['LongshotLauncher-data', 'user']] as const) {
      const candidateUserDir = path.join(gameDir, ...rel)
      if (fs.existsSync(candidateUserDir)) {
        pushUnique(candidateUserDir)
      }
    }
    collectWinePrefixSaveDirs(gameDir, pushUnique)
  }
}

let runtimeCustomSaveDir: string | null = null
// undefined = defer to process.env.CUSTOM_SAVE_SLOT; null = explicitly auto-latest; string = explicit slot
let runtimeSelectedSaveSlot: string | null | undefined = undefined

const knownExplicitCandidateDirs = new Set<string>()
const knownDefaultCandidateDirs = new Set<string>()

const saveSelectionResetListeners = new Set<() => void>()

export function registerSaveSelectionResetListener(fn: () => void): void {
  saveSelectionResetListeners.add(fn)
}

export function getRuntimeCustomSaveDir(): string | null {
  return runtimeCustomSaveDir
}

function getEffectiveSelectedSaveSlot(env: NodeJS.ProcessEnv = process.env): string | null {
  if (runtimeSelectedSaveSlot !== undefined) {
    return runtimeSelectedSaveSlot
  }
  const envSlot = env.CUSTOM_SAVE_SLOT?.trim()
  return envSlot || null
}

/**
 * Returns candidate emulator save root directories in priority order:
 * runtime custom save override / CUSTOM_SAVE_DIR first,
 * then explicit LICHII_SAVE_DIR / FRITCHII_SAVE_DIR / CHEEZYEMU_SAVE_DIR / LONGSHOT_SAVE_DIR / RELINK_SAVE_DIR / TRIFORCE_SAVE_DIR /
 * NX2SARIA_SAVE_DIR overrides,
 * then default %APPDATA%\{fritchii,lichii,eden,cheezyemu}\nand\user\save\{0000000000000000,account},
 * Linux $XDG_DATA_HOME/{fritchii,lichii,eden,cheezyemu}/nand/user/save/{0000000000000000,account} (or ~/.local/share),
 * shared Longshot / LongshotLauncher user save directories (%APPDATA%\Longshot, %LOCALAPPDATA%\Programs\LongshotLauncher\LongshotLauncher-data\user,
 * $XDG_DATA_HOME/longshot),
 * Longshot/Hookshot/HeyListen/ProjectReLink/Triforce user paths,
 * and existing Linux Wine, Steam/Proton, Flatpak, Bottles, Heroic, and Lutris ~/Games/* paths.
 */
export function getCandidateSaveDirs(
  env: NodeJS.ProcessEnv = process.env,
  includeRuntimeOverride = env === process.env,
): string[] {
  const dirs: string[] = []
  const seen = new Set<string>()
  const pushUniqueWithClass = (candidatePath: string, isExplicit: boolean) => {
    const resolved = path.resolve(candidatePath)
    const dedupeKey = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    const classifyKey = resolved.toLowerCase()
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey)
      dirs.push(resolved)
      if (isExplicit) {
        knownExplicitCandidateDirs.add(classifyKey)
        knownDefaultCandidateDirs.delete(classifyKey)
      } else {
        knownDefaultCandidateDirs.add(classifyKey)
        knownExplicitCandidateDirs.delete(classifyKey)
      }
    }
  }
  const pushExplicit = (candidatePath: string) => pushUniqueWithClass(candidatePath, true)
  const pushDefault = (candidatePath: string) => pushUniqueWithClass(candidatePath, false)

  if (includeRuntimeOverride && runtimeCustomSaveDir) {
    pushExplicit(runtimeCustomSaveDir)
  }

  for (const explicitRaw of [
    env.CUSTOM_SAVE_DIR,
    env.LICHII_SAVE_DIR,
    env.FRITCHII_SAVE_DIR,
    env.CHEEZYEMU_SAVE_DIR,
    env.LONGSHOT_SAVE_DIR,
    env.RELINK_SAVE_DIR,
    env.TRIFORCE_SAVE_DIR,
    env.NX2SARIA_SAVE_DIR,
  ]) {
    const explicit = explicitRaw?.trim()
    if (explicit) {
      pushExplicit(explicit)
    }
  }

  const home = os.homedir()
  const appData = env.APPDATA?.trim() || path.join(home, 'AppData', 'Roaming')
  const localAppData = env.LOCALAPPDATA?.trim() || path.join(home, 'AppData', 'Local')
  const xdgDataHome = env.XDG_DATA_HOME?.trim() || path.join(home, '.local', 'share')
  for (const dataRoot of [appData, xdgDataHome]) {
    for (const emu of DEFAULT_EMULATOR_SAVE_ROOTS) {
      for (const saveSub of DEFAULT_EMULATOR_NAND_SAVE_SUBDIRS) {
        pushDefault(path.join(dataRoot, emu, 'nand', 'user', 'save', saveSub))
      }
    }
  }

  pushDefault(path.join(appData, 'Longshot'))
  pushDefault(path.join(appData, 'Longshot', 'user'))
  pushDefault(
    path.join(localAppData, 'Programs', 'LongshotLauncher', 'LongshotLauncher-data', 'user'),
  )
  if (path.resolve(xdgDataHome).toLowerCase() !== path.resolve(appData).toLowerCase()) {
    pushDefault(path.join(xdgDataHome, 'longshot'))
    pushDefault(path.join(xdgDataHome, 'longshot', 'user'))
  }

  for (const recompUserDir of getDefaultRecompSaveDirs()) {
    pushDefault(recompUserDir)
  }

  collectLinuxContainerSaveDirs(env, xdgDataHome, pushDefault)

  return dirs
}

const INPLACE_SECTIONS = new Set([1, 3, 5, 7, 21])

export type ParsedSaveSlot = {
  slotName: string
  mtimeMs: number
  scene: string | null
  subScene: string | null
  position: { x: number; y: number; z: number; yaw: number } | null
  skulltulaCount: number | null
  lastPickedItem: string | null
  savedHashes: Set<bigint>
  savedHeartPieceBoolIds: string[]
  savedBeanIds: string[]
  savedFairyIds: string[]
  savedBottleIds: string[]
  savedThoughtIds: string[]
  savedRequirementKeys: string[]
}

let cachedSaveSlot: ParsedSaveSlot | null = null
let cachedSaveKey = ''

const SAVE_SLOT_SCAN_TTL_MS = 1500
let cachedLatestSlotInfo: SaveSlotSelectionResult | null = null
let lastSaveSlotScanTime = 0

export function readNullTerminatedAscii(buf: Buffer, offset: number, maxLen = 64): string {
  if (offset < 0 || offset >= buf.length) return ''
  const end = Math.min(buf.length, offset + maxLen)
  let i = offset
  while (i < end && buf[i] !== 0) i++
  return buf.subarray(offset, i).toString('ascii').trim()
}

function addSlotIfValid(slotDir: string, slots: Set<string>): void {
  const capPath = path.join(slotDir, 'caption.sav')
  const progPath = path.join(slotDir, 'progress.sav')
  if (fs.existsSync(capPath) || fs.existsSync(progPath)) {
    slots.add(slotDir)
  }
}

function collectSlotsFromTitleDir(titleDir: string, slots: Set<string>): void {
  if (!fs.existsSync(titleDir)) return
  for (const name of listSubdirsSafe(titleDir)) {
    if (name.startsWith('slot_')) {
      addSlotIfValid(path.join(titleDir, name), slots)
    }
  }
}

/**
 * Collects slots from a Switch title save directory (`0400486024DEC000`), supporting both
 * direct `0400486024DEC000/slot_*` and `account/<uid>/0400486024DEC000/0/slot_*` layouts.
 */
function collectSlotsFromSwitchTitleDir(titleDir: string, slots: Set<string>): void {
  if (!fs.existsSync(titleDir)) return
  for (const name of listSubdirsSafe(titleDir)) {
    const childPath = path.join(titleDir, name)
    if (name.startsWith('slot_')) {
      addSlotIfValid(childPath, slots)
    } else {
      collectSlotsFromTitleDir(childPath, slots)
    }
  }
}

function collectSlotsFromAccountDir(accountDir: string, slots: Set<string>): void {
  if (!fs.existsSync(accountDir)) return
  for (const userName of listSubdirsSafe(accountDir)) {
    collectSlotsFromSwitchTitleDir(path.join(accountDir, userName, OOT_REMAKE_TITLE_ID), slots)
    collectSlotsFromTitleDir(path.join(accountDir, userName), slots)
  }
}

function collectSlotsFromSaveBase(saveBaseDir: string, slots: Set<string>): void {
  if (!fs.existsSync(saveBaseDir)) return
  for (const accountName of listSubdirsSafe(saveBaseDir)) {
    collectSlotsFromAccountDir(path.join(saveBaseDir, accountName), slots)
  }
  // Longshot/Hookshot store saves at <user>/save/<32-hex-uid>/slot_* without an account folder
  collectSlotsFromAccountDir(saveBaseDir, slots)
}

function collectSlotsInCandidateRoot(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return []
  const slots = new Set<string>()

  // Level 4: Direct slot_* folder (or folder directly holding caption.sav / progress.sav)
  addSlotIfValid(rootDir, slots)
  // Level 3: Title ID folder (0400486024DEC000) or Longshot/ReLink/HeyListen UID profile folder containing slot_*
  if (path.basename(rootDir).toUpperCase() === OOT_REMAKE_TITLE_ID) {
    collectSlotsFromSwitchTitleDir(rootDir, slots)
  } else {
    collectSlotsFromTitleDir(rootDir, slots)
  }
  // Level 3 (Switch profile): Profile folder (<userId>) containing 0400486024DEC000/[0/]slot_*
  collectSlotsFromSwitchTitleDir(path.join(rootDir, OOT_REMAKE_TITLE_ID), slots)
  // Level 2: Account folder (0000000000000000 / account) or user/save / profile/save containing <userId>/slot_*
  collectSlotsFromAccountDir(rootDir, slots)

  // Level 1 & 2: Full game install root / LongshotLauncher-data / user / profile / nand layouts
  const saveRoots = [
    path.join(rootDir, 'nand', 'user', 'save'),
    path.join(rootDir, 'user', 'nand', 'user', 'save'),
    path.join(rootDir, 'user', 'save'),
    path.join(rootDir, 'LongshotLauncher-data', 'user', 'save'),
    path.join(rootDir, 'LongshotLauncher-data', 'save'),
    path.join(rootDir, 'profile', 'save'),
    path.join(rootDir, 'user'),
    path.join(rootDir, 'save'),
    ...collectLongshotInstanceSaveRoots(rootDir),
  ]
  if (path.basename(rootDir).toLowerCase() === 'save') {
    saveRoots.push(rootDir)
  }
  for (const saveRoot of saveRoots) {
    collectSlotsFromSaveBase(saveRoot, slots)
  }

  return Array.from(slots)
}

/**
 * Detects which emulator owns a save slot path: paths under NX2SARIA_SAVE_DIR are NX2Saria,
 * otherwise the path segments decide.
 */
export function detectEmulatorFromPath(
  dirPath: string,
  env: NodeJS.ProcessEnv = process.env,
): EmulatorKind | undefined {
  const resolved = path.resolve(dirPath).toLowerCase()
  const nx2sariaRaw = env.NX2SARIA_SAVE_DIR?.trim()
  if (nx2sariaRaw) {
    // NX2Saria saves live in its game folder, whose name is not recognizable
    const nx2sariaRoot = path.resolve(nx2sariaRaw).toLowerCase()
    if (resolved === nx2sariaRoot || resolved.startsWith(nx2sariaRoot + path.sep)) return 'nx2saria'
  }
  const segments = resolved.split(/[\\/]/)
  for (const emu of DEFAULT_EMULATOR_SAVE_ROOTS) {
    if (segments.includes(emu)) return emu
  }
  if (segments.includes('projectrelink') || segments.includes('relink')) {
    return 'relink'
  }
  if (segments.includes('triforce')) {
    return 'triforce'
  }
  if (
    segments.includes('longshot') ||
    segments.includes('longshotlauncher') ||
    segments.includes('longshotlauncher-data') ||
    segments.includes('hookshot') ||
    segments.includes('heylisten')
  ) {
    return 'longshot'
  }
  return undefined
}

function isDefaultEmulatorSaveDir(dir: string): boolean {
  const normalized = path.resolve(dir).toLowerCase()
  if (knownExplicitCandidateDirs.has(normalized)) {
    return false
  }
  if (knownDefaultCandidateDirs.has(normalized)) {
    return true
  }
  if (
    DEFAULT_EMULATOR_SAVE_ROOTS.some((emu) =>
      DEFAULT_EMULATOR_NAND_SAVE_SUBDIRS.some((saveSub) =>
        normalized.endsWith(`${path.sep}${path.join(emu, 'nand', 'user', 'save', saveSub)}`.toLowerCase()),
      ),
    )
  ) {
    return true
  }
  if (getDefaultRecompSaveDirs().some((d) => normalized === path.resolve(d).toLowerCase())) {
    return true
  }
  const gamesPrefix = `${path.resolve(path.join(os.homedir(), 'Games')).toLowerCase()}${path.sep}`
  if (normalized.startsWith(gamesPrefix)) {
    return true
  }
  return (
    normalized.includes(`${path.sep}drive_c${path.sep}`) ||
    normalized.includes(`${path.sep}compatdata${path.sep}`) ||
    normalized.includes(`${path.sep}.var${path.sep}app${path.sep}`) ||
    normalized.includes(`${path.sep}bottles${path.sep}`) ||
    normalized.includes(`${path.sep}heroic${path.sep}`)
  )
}

export type SaveSlotSelectionResult = {
  dir: string
  key: string
  mtimeMs: number
  profileDir: string
  slotName: string
  availableSaveSlots: string[]
}

function isCustomOverrideDir(dir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const normalized = path.resolve(dir)
  const cmp = (a: string, b: string) =>
    process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  if (runtimeCustomSaveDir && cmp(normalized, runtimeCustomSaveDir)) return true
  const envCustom = env.CUSTOM_SAVE_DIR?.trim()
  if (envCustom && cmp(normalized, path.resolve(envCustom))) return true
  return false
}

function statSlotDir(slotDir: string): { dir: string; key: string; mtimeMs: number } | null {
  try {
    const capPath = path.join(slotDir, 'caption.sav')
    const progPath = path.join(slotDir, 'progress.sav')
    const capStat = fs.existsSync(capPath) ? fs.statSync(capPath) : null
    const progStat = fs.existsSync(progPath) ? fs.statSync(progPath) : null
    if (!capStat && !progStat) return null
    const mtimeMs = Math.max(capStat?.mtimeMs ?? 0, progStat?.mtimeMs ?? 0)
    return {
      dir: slotDir,
      key: `${slotDir}:${capStat?.mtimeMs ?? 0}:${progStat?.mtimeMs ?? 0}`,
      mtimeMs,
    }
  } catch {
    return null
  }
}

function collectAvailableSlotsInProfile(profileDir: string): string[] {
  const slots = new Set<string>()
  collectSlotsFromTitleDir(profileDir, slots)
  return Array.from(slots)
    .map((dir) => path.basename(dir))
    .sort()
}

function resolveSlotInRoot(
  candidateRoot: string,
  selectedSlot: string | null,
): SaveSlotSelectionResult | null {
  const slotDirs = collectSlotsInCandidateRoot(candidateRoot)
  if (slotDirs.length === 0) return null

  let bestLatest: { dir: string; key: string; mtimeMs: number } | null = null
  for (const slotDir of slotDirs) {
    const info = statSlotDir(slotDir)
    if (info && (!bestLatest || info.mtimeMs > bestLatest.mtimeMs)) {
      bestLatest = info
    }
  }
  if (!bestLatest) return null

  const baseName = path.basename(bestLatest.dir)
  const isNamedSlot = baseName.startsWith('slot_')
  const profileDir = isNamedSlot ? path.dirname(bestLatest.dir) : bestLatest.dir
  const availableSaveSlots = isNamedSlot ? collectAvailableSlotsInProfile(profileDir) : []

  let chosen = bestLatest
  if (selectedSlot && isNamedSlot && availableSaveSlots.includes(selectedSlot)) {
    const selectedStat = statSlotDir(path.join(profileDir, selectedSlot))
    if (selectedStat) {
      chosen = selectedStat
    }
  }

  return {
    dir: chosen.dir,
    key: chosen.key,
    mtimeMs: chosen.mtimeMs,
    profileDir,
    slotName: path.basename(chosen.dir),
    availableSaveSlots,
  }
}

/**
 * Resolves the active save slot and available slots in the winning profile across candidate save roots.
 * Custom/explicit *_SAVE_DIR overrides take priority over default %APPDATA%, $XDG_DATA_HOME,
 * and ~/Games recomp roots; among default roots, the most recently modified save slot
 * selects the winning profile.
 */
export function resolveSaveSlotSelection(
  candidateDirs: string[] = getCandidateSaveDirs(),
  selectedSlot: string | null = getEffectiveSelectedSaveSlot(),
): SaveSlotSelectionResult | null {
  const explicitDirs: string[] = []
  const defaultDirs: string[] = []

  for (const candidateRoot of candidateDirs) {
    if (!isCustomOverrideDir(candidateRoot) && isDefaultEmulatorSaveDir(candidateRoot)) {
      defaultDirs.push(candidateRoot)
    } else {
      explicitDirs.push(candidateRoot)
    }
  }

  for (const explicitRoot of explicitDirs) {
    const found = resolveSlotInRoot(explicitRoot, selectedSlot)
    if (found) return found
  }

  let bestDefault: SaveSlotSelectionResult | null = null
  let bestDefaultLatestMtime = -1
  for (const defaultRoot of defaultDirs) {
    // Compare winning profiles by their most recently modified slot so selecting an older slot
    // doesn't unexpectedly jump to a different emulator's profile.
    const latestInRoot = resolveSlotInRoot(defaultRoot, null)
    if (latestInRoot && latestInRoot.mtimeMs > bestDefaultLatestMtime) {
      bestDefaultLatestMtime = latestInRoot.mtimeMs
      bestDefault =
        selectedSlot && latestInRoot.availableSaveSlots.includes(selectedSlot)
          ? resolveSlotInRoot(defaultRoot, selectedSlot) ?? latestInRoot
          : latestInRoot
    }
  }

  return bestDefault
}

/**
 * Finds the most recently modified save slot directory (or the selected slot if valid) across candidate save roots.
 */
export function findLatestSaveSlotDir(
  candidateDirs: string[] = getCandidateSaveDirs(),
  selectedSlot: string | null = getEffectiveSelectedSaveSlot(),
): { dir: string; key: string; mtimeMs: number } | null {
  const resolved = resolveSaveSlotSelection(candidateDirs, selectedSlot)
  return resolved ? { dir: resolved.dir, key: resolved.key, mtimeMs: resolved.mtimeMs } : null
}

/** Sets or clears the runtime selected save slot (`null` = auto-select most recently modified). */
export function setSelectedSaveSlot(slot: string | null): void {
  runtimeSelectedSaveSlot = slot?.trim() || null
  lastSaveSlotScanTime = 0
  cachedLatestSlotInfo = null
  cachedSaveSlot = null
  cachedSaveKey = ''
  for (const listener of saveSelectionResetListeners) {
    listener()
  }
}

/** Returns true if a save directory path is a Windows UNC path or contains NUL bytes. */
export function isUncSavePath(rawPath: string): boolean {
  if (rawPath.includes('\0')) return true
  const trimmed = rawPath.trim()
  return /^[\\/]{2}/.test(trimmed)
}

/** Sets or clears the runtime custom save directory and selected save slot override. */
export function setCustomSaveOverride(dir: string | null, slot: string | null): void {
  const trimmed = dir?.trim() || null
  if (trimmed && isUncSavePath(trimmed)) {
    throw new TypeError('UNC paths are not allowed for save directories')
  }
  runtimeCustomSaveDir = trimmed ? path.resolve(trimmed) : null
  setSelectedSaveSlot(slot)
}

export function refreshCachedSaveSlotSelection(): SaveSlotSelectionResult | null {
  const now = Date.now()
  if (now - lastSaveSlotScanTime >= SAVE_SLOT_SCAN_TTL_MS) {
    cachedLatestSlotInfo = resolveSaveSlotSelection()
    lastSaveSlotScanTime = now
  }
  return cachedLatestSlotInfo
}

export function getCachedLatestSlotInfo(): SaveSlotSelectionResult | null {
  return cachedLatestSlotInfo
}

export function getLastSaveSlotScanTime(): number {
  return lastSaveSlotScanTime
}

export function getCachedSaveState(): ParsedSaveSlot | null {
  const slotInfo = refreshCachedSaveSlotSelection()
  return slotInfo ? parseSaveSlot(slotInfo) : null
}

export function parseSaveSlot(slotInfo: { dir: string; key: string; mtimeMs: number }): ParsedSaveSlot | null {
  if (cachedSaveSlot && cachedSaveKey === slotInfo.key) {
    return cachedSaveSlot
  }

  const capPath = path.join(slotInfo.dir, 'caption.sav')
  const progPath = path.join(slotInfo.dir, 'progress.sav')

  let scene: string | null = null
  let subScene: string | null = null
  let pos: { x: number; y: number; z: number } | null = null
  let yaw = 0
  let skulltulaCount: number | null = null
  let lastPickedItem: string | null = null
  const savedHashes = new Set<bigint>()
  const savedHeartPieceBoolIds = new Set<string>()
  const savedBeanIds = new Set<string>()
  const savedFairyIds = new Set<string>()
  const savedBottleIds = new Set<string>()
  const savedThoughtIds = new Set<string>()
  const savedRequirementKeys = new Set<string>()

  try {
    if (fs.existsSync(capPath)) {
      const cap = fs.readFileSync(capPath)
      if (cap.length >= 0x28) {
        const dataOff = cap.readUInt32LE(8)
        for (let off = 0x28; off + 8 <= dataOff && off + 8 <= cap.length; off += 8) {
          const h = cap.readUInt32LE(off)
          const v = cap.readUInt32LE(off + 4)
          if (h === 0xdc941483) {
            skulltulaCount = v
          } else if (h === 0xaccbda17) {
            yaw = cap.readFloatLE(off + 4)
          } else if (h === 0x8b26618e && v + 12 <= cap.length) {
            pos = {
              x: cap.readFloatLE(v),
              y: cap.readFloatLE(v + 4),
              z: cap.readFloatLE(v + 8),
            }
          } else if (h === 0xf74e0e8e && v < cap.length) {
            scene = readNullTerminatedAscii(cap, v, 64) || scene
          } else if (h === 0x0cccc6cd && v < cap.length) {
            subScene = readNullTerminatedAscii(cap, v, 64) || subScene
          }
        }
      }
    }

    if (fs.existsSync(progPath)) {
      const prog = fs.readFileSync(progPath)
      if (prog.length >= 0x28) {
        const dataOff = prog.readUInt32LE(8)
        let sec = 1
        const ptrs: Array<{ off: number; h: number }> = []
        for (let off = 0x28; off + 8 <= dataOff && off + 8 <= prog.length; off += 8) {
          const h = prog.readUInt32LE(off)
          const v = prog.readUInt32LE(off + 4)
          if (h === 0) {
            sec = v + 1
            continue
          }
          const isPtr = !INPLACE_SECTIONS.has(sec)
          if (!isPtr) {
            if (h === 0x04735978) {
              skulltulaCount = v
            } else if (h === 0xa4aee8cd) {
              yaw = prog.readFloatLE(off + 4)
            } else if (sec === 1 && v !== 0) {
              const hpId = KNOWN_HEART_PIECE_BOOL_HASH_TO_ITEM_ID.get(h)
              if (hpId) savedHeartPieceBoolIds.add(hpId)
              const beanId = KNOWN_BEAN_BOOL_HASH_TO_ITEM_ID.get(h)
              if (beanId) savedBeanIds.add(beanId)
              const fairyId = KNOWN_FAIRY_BOOL_HASH_TO_ITEM_ID.get(h)
              if (fairyId) savedFairyIds.add(fairyId)
              const bottleId = KNOWN_BOTTLE_BOOL_HASH_TO_ITEM_ID.get(h)
              if (bottleId) savedBottleIds.add(bottleId)
              const thoughtId = KNOWN_THOUGHT_BOOL_HASH_TO_ITEM_ID.get(h)
              if (thoughtId) savedThoughtIds.add(thoughtId)
              const reqKey = KNOWN_REQUIREMENT_BOOL_HASH_TO_KEY.get(h)
              if (reqKey) savedRequirementKeys.add(reqKey)
            } else if (sec === 3 && h === GHOST_SHOP_COUPON_NUM_HASH) {
              if (prog.readInt32LE(off + 4) >= GHOST_SHOP_COUPON_THRESHOLD) {
                savedBottleIds.add(GHOST_SHOP_COUPON_BOTTLE_ITEM_ID)
              }
            }
          } else if (v >= dataOff && v < prog.length) {
            ptrs.push({ off: v, h })
          }
        }

        ptrs.sort((a, b) => a.off - b.off)
        for (let i = 0; i < ptrs.length; i++) {
          const curr = ptrs[i]!
          const nextOff = i + 1 < ptrs.length ? ptrs[i + 1]!.off : prog.length
          const blob = prog.subarray(curr.off, nextOff)

          if (curr.h === 0x72c4152b) {
            lastPickedItem = readNullTerminatedAscii(blob, 0, 64) || null
          } else if ((curr.h === 0x960ad56a || curr.h === 0xc884818d) && blob.length >= 12 && !pos) {
            pos = {
              x: blob.readFloatLE(0),
              y: blob.readFloatLE(4),
              z: blob.readFloatLE(8),
            }
          } else if (curr.h === 0x4a6bdb7d && !scene) {
            scene = readNullTerminatedAscii(blob, 0, 32) || null
          } else if (curr.h === 0xa3db7114) {
            for (let k = 0; k + 8 <= blob.length; k += 8) {
              const u64 = blob.readBigUInt64LE(k)
              if (u64 !== 0n) savedHashes.add(u64)
            }
          }
        }
      }
    }
  } catch {
    return null
  }

  if (savedBeanIds.size > 0) {
    savedRequirementKeys.add('planted-bean')
  }

  const normYaw = ((yaw % 360) + 360) % 360
  const parsed: ParsedSaveSlot = {
    slotName: path.basename(slotInfo.dir),
    mtimeMs: slotInfo.mtimeMs,
    scene,
    subScene,
    position: pos ? { ...pos, yaw: Number(normYaw.toFixed(1)) } : null,
    skulltulaCount,
    lastPickedItem,
    savedHashes,
    savedHeartPieceBoolIds: Array.from(savedHeartPieceBoolIds).sort(),
    savedBeanIds: Array.from(savedBeanIds).sort(),
    savedFairyIds: Array.from(savedFairyIds).sort(),
    savedBottleIds: Array.from(savedBottleIds).sort(),
    savedThoughtIds: Array.from(savedThoughtIds).sort(),
    savedRequirementKeys: Array.from(savedRequirementKeys).sort(),
  }
  cachedSaveKey = slotInfo.key
  cachedSaveSlot = parsed
  return parsed
}
