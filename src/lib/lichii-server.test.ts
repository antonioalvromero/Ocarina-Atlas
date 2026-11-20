import fs from 'node:fs'
import type http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { dataset, formatFloorLabel } from './data'
import {
  classifyGdmCollectibles,
  classifyGdmRequirements,
  closeLichiiRpc,
  deriveConnectionStatus,
  deriveDynamicVtables,
  deriveLastPickedItem,
  detectEmulatorFromPath,
  determineDungeonFloor,
  findLatestSaveSlotDir,
  getCandidateSaveDirs,
  getLichiiHost,
  getLichiiPort,
  getLichiiTelemetryState,
  getMinGuestHeapPtr,
  handleLichiiStreamRequest,
  handleSaveSlotApiRequest,
  GHOST_SHOP_COUPON_BOTTLE_ITEM_ID,
  GHOST_SHOP_COUPON_NUM_HASH,
  isLoopbackRequest,
  isUncSavePath,
  isValidSub36Buffer,
  KNOWN_BEAN_BOOL_HASH_MAP,
  KNOWN_BOTTLE_BOOL_HASH_MAP,
  KNOWN_FAIRY_BOOL_HASH_MAP,
  KNOWN_HEART_CONTAINER_HASH_MAP,
  KNOWN_HEART_PIECE_BOOL_HASH_MAP,
  KNOWN_HEART_PIECE_HASH_MAP,
  KNOWN_REQUIREMENT_BOOL_HASH_MAP,
  KNOWN_SKULLTULA_HASH_MAP,
  KNOWN_THOUGHT_BOOL_HASH_MAP,
  LichiiRpcClient,
  MAX_SSE_CLIENTS,
  parseGdmBoolEntryBuffer,
  parseGdmContainerHeader,
  parseGdmIntEntryBuffer,
  parseGdmSkulltulaCount,
  parseGdmStockNumBuffer,
  parseLichiiPort,
  parseMasterFlagTableBuffer,
  parseSaveBufCollectibleRange,
  parseSaveBufHeartPieceBoolRange,
  parseSaveSlot,
  projectToPlaceMap,
  redactTelemetryStateForRemote,
  resolveSaveSlotSelection,
  sanitizeTelemetryStateForRequest,
  setCustomSaveOverride,
  setSelectedSaveSlot,
  resolveEffectiveScene,
  scanGdmContainerHashTableBuffer,
  validateMainBaseHeader,
} from './lichii-server'
import { reconcileSkulltulaLists } from './useLichiiTracker'

describe('determineDungeonFloor (Spirit Temple)', () => {
  it('maps PB (1F) below Y=109.5, P1 (2F) at 109.5..127.5, P2 (3F) at 127.5..148, P3 (4F) >=148', () => {
    expect(determineDungeonFloor('espiritu', 104.17)).toBe('1F')
    expect(determineDungeonFloor('espiritu', 114.18)).toBe('2F')
    expect(determineDungeonFloor('espiritu', 124.76)).toBe('2F')
    expect(determineDungeonFloor('espiritu', 129.35)).toBe('3F')
    expect(determineDungeonFloor('espiritu', 148.5)).toBe('4F')
  })
})

describe('formatFloorLabel', () => {
  it('normalizes floor IDs and map keys to clean English labels', () => {
    expect(formatFloorLabel('1F')).toBe('1F')
    expect(formatFloorLabel('2F')).toBe('2F')
    expect(formatFloorLabel('3F')).toBe('3F')
    expect(formatFloorLabel('4F')).toBe('4F')
    expect(formatFloorLabel('5F')).toBe('5F')
    expect(formatFloorLabel('S1')).toBe('B1')
    expect(formatFloorLabel('B1')).toBe('B1')
    expect(formatFloorLabel('S2')).toBe('B2')
    expect(formatFloorLabel('B2')).toBe('B2')
    expect(formatFloorLabel('S3')).toBe('B3')
    expect(formatFloorLabel('B3')).toBe('B3')
    expect(formatFloorLabel('S4')).toBe('B4')
    expect(formatFloorLabel('B4')).toBe('B4')
    expect(formatFloorLabel('nino')).toBe('Child')
    expect(formatFloorLabel('adulto')).toBe('Adult')
    expect(formatFloorLabel('principal')).toBe('Main')
    expect(formatFloorLabel('custom')).toBe('custom')
  })
})

describe('Lichii environment config helpers', () => {
  it('resolves LICHII_HOST / FRITCHII_HOST with whitespace trimming and 127.0.0.1 fallback', () => {
    expect(getLichiiHost({})).toBe('127.0.0.1')
    expect(getLichiiHost({ LICHII_HOST: '   ' })).toBe('127.0.0.1')
    expect(getLichiiHost({ LICHII_HOST: ' 192.168.1.42 ' })).toBe('192.168.1.42')
    expect(getLichiiHost({ FRITCHII_HOST: ' 127.0.0.2 ' })).toBe('127.0.0.2')
    expect(getLichiiHost({ LICHII_HOST: '10.0.0.2', FRITCHII_HOST: '127.0.0.2' })).toBe('10.0.0.2')
  })

  it('validates LICHII_PORT / FRITCHII_PORT within 1..65535 and falls back to 6545', () => {
    expect(parseLichiiPort(undefined)).toBe(6545)
    expect(parseLichiiPort('')).toBe(6545)
    expect(parseLichiiPort('0')).toBe(6545)
    expect(parseLichiiPort('-1')).toBe(6545)
    expect(parseLichiiPort('65536')).toBe(6545)
    expect(parseLichiiPort('6545abc')).toBe(6545)
    expect(parseLichiiPort('6545.5')).toBe(6545)
    expect(parseLichiiPort('1')).toBe(1)
    expect(parseLichiiPort(' 7000 ')).toBe(7000)
    expect(parseLichiiPort('65535')).toBe(65535)

    expect(getLichiiPort({})).toBe(6545)
    expect(getLichiiPort({ LICHII_PORT: '7777' })).toBe(7777)
    expect(getLichiiPort({ FRITCHII_PORT: '7788' })).toBe(7788)
    expect(getLichiiPort({ LICHII_PORT: '7777', FRITCHII_PORT: '7788' })).toBe(7777)
    expect(getLichiiPort({ LICHII_PORT: 'invalid' })).toBe(6545)
  })

  it('checks LICHII_SAVE_DIR / FRITCHII_SAVE_DIR / CHEEZYEMU_SAVE_DIR / LONGSHOT_SAVE_DIR / RELINK_SAVE_DIR / TRIFORCE_SAVE_DIR / NX2SARIA_SAVE_DIR before default APPDATA, XDG_DATA_HOME, and recomp save directories', () => {
    const appData = path.join(os.tmpdir(), 'fake-appdata')
    const xdgDataHome = path.join(os.tmpdir(), 'fake-xdg-data')
    const fallbackXdgDataHome = path.join(os.homedir(), '.local', 'share')
    const explicit = path.join(os.tmpdir(), 'custom-lichii-saves')
    const explicitFritchii = path.join(os.tmpdir(), 'custom-fritchii-saves')
    const explicitCheezy = path.join(os.tmpdir(), 'custom-cheezy-saves')
    const explicitLongshot = path.join(os.tmpdir(), 'custom-longshot-saves')
    const explicitRelink = path.join(os.tmpdir(), 'custom-relink-saves')
    const explicitTriforce = path.join(os.tmpdir(), 'custom-triforce-saves')
    const explicitNx2Saria = path.join(os.tmpdir(), 'custom-nx2saria-profile')
    const emulators = ['fritchii', 'lichii', 'eden', 'cheezyemu'] as const
    const appDataDefaults = emulators.map((emu) =>
      path.resolve(appData, emu, 'nand', 'user', 'save', '0000000000000000'),
    )
    const fallbackXdgDefaults = emulators.map((emu) =>
      path.resolve(fallbackXdgDataHome, emu, 'nand', 'user', 'save', '0000000000000000'),
    )
    const customXdgDefaults = emulators.map((emu) =>
      path.resolve(xdgDataHome, emu, 'nand', 'user', 'save', '0000000000000000'),
    )
    const recompDefaults = [
      path.resolve('E:\\Longshot\\Game\\user'),
      path.resolve(path.join(os.homedir(), 'Games', 'Longshot', 'user')),
      path.resolve(path.join(os.homedir(), 'Games', 'Hookshot', 'user')),
      path.resolve(path.join(os.homedir(), 'Games', 'HeyListen', 'user')),
      path.resolve(path.join(os.homedir(), 'Games', 'ProjectReLink', 'user')),
      path.resolve(path.join(os.homedir(), 'Games', 'ProjectReLink', 'game', 'user')),
      path.resolve(path.join(os.homedir(), 'Games', 'ReLink', 'user')),
      path.resolve(path.join(os.homedir(), 'Games', 'ReLink', 'game', 'user')),
      path.resolve(path.join(os.homedir(), 'Games', 'Triforce', 'user')),
    ]
    const defaultDirs = [...appDataDefaults, ...fallbackXdgDefaults, ...recompDefaults]
    const customXdgDirs = [...appDataDefaults, ...customXdgDefaults, ...recompDefaults]

    expect(getCandidateSaveDirs({ APPDATA: appData })).toEqual(defaultDirs)
    expect(getCandidateSaveDirs({ APPDATA: appData, XDG_DATA_HOME: '   ', LICHII_SAVE_DIR: '   ' })).toEqual(
      defaultDirs,
    )
    expect(getCandidateSaveDirs({ APPDATA: appData, XDG_DATA_HOME: xdgDataHome })).toEqual(customXdgDirs)
    // Deduplicates when APPDATA and XDG_DATA_HOME resolve to the same directory
    expect(getCandidateSaveDirs({ APPDATA: appData, XDG_DATA_HOME: `${appData}${path.sep}` })).toEqual([
      ...appDataDefaults,
      ...recompDefaults,
    ])
    expect(
      getCandidateSaveDirs({
        APPDATA: appData,
        XDG_DATA_HOME: xdgDataHome,
        LICHII_SAVE_DIR: explicit,
        FRITCHII_SAVE_DIR: explicitFritchii,
        CHEEZYEMU_SAVE_DIR: explicitCheezy,
        LONGSHOT_SAVE_DIR: explicitLongshot,
        RELINK_SAVE_DIR: explicitRelink,
        TRIFORCE_SAVE_DIR: explicitTriforce,
        NX2SARIA_SAVE_DIR: explicitNx2Saria,
      }),
    ).toEqual([
      path.resolve(explicit),
      path.resolve(explicitFritchii),
      path.resolve(explicitCheezy),
      path.resolve(explicitLongshot),
      path.resolve(explicitRelink),
      path.resolve(explicitTriforce),
      path.resolve(explicitNx2Saria),
      ...customXdgDirs,
    ])
  })

  it('selects the most recently modified save slot across fritchii, lichii, and eden defaults', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fritchii-save-test-'))
    try {
      const appDataDir = path.join(tmpRoot, 'appdata')
      const lichiiSlot = path.join(
        appDataDir,
        'lichii',
        'nand',
        'user',
        'save',
        '0000000000000000',
        '0000000000000001',
        '0400486024DEC000',
        'slot_00',
      )
      const fritchiiSlot = path.join(
        appDataDir,
        'fritchii',
        'nand',
        'user',
        'save',
        '0000000000000000',
        'B20831C4ABF20667A1EF55C894868D34',
        '0400486024DEC000',
        'slot_00',
      )
      fs.mkdirSync(lichiiSlot, { recursive: true })
      fs.mkdirSync(fritchiiSlot, { recursive: true })

      const lichiiCap = path.join(lichiiSlot, 'caption.sav')
      const fritchiiCap = path.join(fritchiiSlot, 'caption.sav')
      fs.writeFileSync(lichiiCap, Buffer.alloc(0x30))
      fs.writeFileSync(fritchiiCap, Buffer.alloc(0x30))

      // Case 1: Fritchii save is newer than Lichii save -> picks Fritchii
      fs.utimesSync(lichiiCap, new Date(1000), new Date(1000))
      fs.utimesSync(fritchiiCap, new Date(5000), new Date(5000))
      const newerFritchii = findLatestSaveSlotDir(getCandidateSaveDirs({ APPDATA: appDataDir }))
      expect(newerFritchii?.dir).toBe(fritchiiSlot)
      expect(detectEmulatorFromPath(newerFritchii!.dir)).toBe('fritchii')

      // Case 2: Lichii save is newer than Fritchii save -> picks Lichii (no shadowing)
      fs.utimesSync(lichiiCap, new Date(9000), new Date(9000))
      const newerLichii = findLatestSaveSlotDir(getCandidateSaveDirs({ APPDATA: appDataDir }))
      expect(newerLichii?.dir).toBe(lichiiSlot)
      expect(detectEmulatorFromPath(newerLichii!.dir)).toBe('lichii')

      // Case 3: FRITCHII_SAVE_DIR explicit override beats newer default saves
      const customFritchiiSlot = path.join(tmpRoot, 'custom-fritchii', 'slot_03')
      fs.mkdirSync(customFritchiiSlot, { recursive: true })
      const customCap = path.join(customFritchiiSlot, 'caption.sav')
      fs.writeFileSync(customCap, Buffer.alloc(0x30))
      fs.utimesSync(customCap, new Date(500), new Date(500))
      const overrideFound = findLatestSaveSlotDir(
        getCandidateSaveDirs({ APPDATA: appDataDir, FRITCHII_SAVE_DIR: customFritchiiSlot }),
      )
      expect(overrideFound?.dir).toBe(customFritchiiSlot)
      expect(detectEmulatorFromPath(path.join(appDataDir, 'eden', 'slot_00'))).toBe('eden')
      expect(detectEmulatorFromPath(customFritchiiSlot)).toBeUndefined()
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('supports direct slot_*, title, and full user/save structures with LICHII_SAVE_DIR priority', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lichii-save-test-'))
    try {
      const appDataDir = path.join(tmpRoot, 'appdata')
      const defaultSlot = path.join(
        appDataDir,
        'lichii',
        'nand',
        'user',
        'save',
        '0000000000000000',
        '0000000000000001',
        '0400486024DEC000',
        'slot_00',
      )
      fs.mkdirSync(defaultSlot, { recursive: true })
      fs.writeFileSync(path.join(defaultSlot, 'caption.sav'), Buffer.alloc(0x30))

      // 1. Default %APPDATA%\lichii\nand\user\save\0000000000000000 discovery
      const defaultFound = findLatestSaveSlotDir(getCandidateSaveDirs({ APPDATA: appDataDir }))
      expect(defaultFound?.dir).toBe(defaultSlot)

      // 2. Direct slot_* override beats default even if default is newer
      const directSlot = path.join(tmpRoot, 'direct', 'slot_02')
      fs.mkdirSync(directSlot, { recursive: true })
      const directCap = path.join(directSlot, 'caption.sav')
      fs.writeFileSync(directCap, Buffer.alloc(0x30))
      fs.utimesSync(directCap, new Date(1000), new Date(1000))

      const directFound = findLatestSaveSlotDir(
        getCandidateSaveDirs({ APPDATA: appDataDir, LICHII_SAVE_DIR: directSlot }),
      )
      expect(directFound?.dir).toBe(directSlot)

      // 3. Full Lichii user/save layout under LICHII_SAVE_DIR
      const altLichiiRoot = path.join(tmpRoot, 'portable-lichii')
      const slot0 = path.join(
        altLichiiRoot,
        'nand',
        'user',
        'save',
        '0000000000000000',
        '0000000000000002',
        '0400486024DEC000',
        'slot_00',
      )
      const slot1 = path.join(path.dirname(slot0), 'slot_01')
      fs.mkdirSync(slot0, { recursive: true })
      fs.mkdirSync(slot1, { recursive: true })
      const s0Prog = path.join(slot0, 'progress.sav')
      const s1Prog = path.join(slot1, 'progress.sav')
      fs.writeFileSync(s0Prog, Buffer.alloc(0x30))
      fs.writeFileSync(s1Prog, Buffer.alloc(0x30))
      fs.utimesSync(s0Prog, new Date(2000), new Date(2000))
      fs.utimesSync(s1Prog, new Date(5000), new Date(5000))

      const fullLayoutFound = findLatestSaveSlotDir(
        getCandidateSaveDirs({ APPDATA: appDataDir, LICHII_SAVE_DIR: path.join(altLichiiRoot, 'nand', 'user', 'save') }),
      )
      expect(fullLayoutFound?.dir).toBe(slot1)
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('supports Longshot <game>/user/save/<32-hex-uid>/slot_00/caption.sav without title ID via LONGSHOT_SAVE_DIR and Games/Longshot/user', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'longshot-save-test-'))
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpRoot)
    try {
      const uid = '0123456789abcdef0123456789abcdef'
      const appDataDir = path.join(tmpRoot, 'appdata')
      const lichiiSlot = path.join(
        appDataDir,
        'lichii',
        'nand',
        'user',
        'save',
        '0000000000000000',
        '0000000000000001',
        '0400486024DEC000',
        'slot_00',
      )
      fs.mkdirSync(lichiiSlot, { recursive: true })
      const lichiiCap = path.join(lichiiSlot, 'caption.sav')
      fs.writeFileSync(lichiiCap, Buffer.alloc(0x30))
      fs.utimesSync(lichiiCap, new Date(9000), new Date(9000))

      // 1. Explicit LONGSHOT_SAVE_DIR pointing to <game>/user beats newer default Lichii save
      const customGameDir = path.join(tmpRoot, 'custom-game')
      const customUserDir = path.join(customGameDir, 'user')
      const customSlot = path.join(customUserDir, 'save', uid, 'slot_00')
      fs.mkdirSync(customSlot, { recursive: true })
      const customCap = path.join(customSlot, 'caption.sav')
      fs.writeFileSync(customCap, Buffer.alloc(0x30))
      fs.utimesSync(customCap, new Date(1000), new Date(1000))

      for (const saveDir of [customGameDir, customUserDir, path.join(customUserDir, 'save')]) {
        const found = findLatestSaveSlotDir(
          getCandidateSaveDirs({ APPDATA: appDataDir, LONGSHOT_SAVE_DIR: saveDir }),
        )
        expect(found?.dir).toBe(customSlot)
      }
      expect(detectEmulatorFromPath(customSlot)).toBeUndefined()

      // 2. Default ~/Games/Longshot/user discovery compares mtime cleanly across emulators
      const gamesLongshotUser = path.join(tmpRoot, 'Games', 'Longshot', 'user')
      const gamesLongshotSlot = path.join(gamesLongshotUser, 'save', uid, 'slot_00')
      fs.mkdirSync(gamesLongshotSlot, { recursive: true })
      const longshotCap = path.join(gamesLongshotSlot, 'caption.sav')
      fs.writeFileSync(longshotCap, Buffer.alloc(0x30))

      // Newer Longshot default save wins over Lichii
      fs.utimesSync(longshotCap, new Date(12000), new Date(12000))
      const newerLongshot = findLatestSaveSlotDir(getCandidateSaveDirs({ APPDATA: appDataDir }))
      expect(newerLongshot?.dir).toBe(gamesLongshotSlot)
      expect(detectEmulatorFromPath(newerLongshot!.dir)).toBe('longshot')

      // Newer Lichii default save wins over Longshot (no shadowing)
      fs.utimesSync(lichiiCap, new Date(15000), new Date(15000))
      const newerLichii = findLatestSaveSlotDir(getCandidateSaveDirs({ APPDATA: appDataDir }))
      expect(newerLichii?.dir).toBe(lichiiSlot)
      expect(detectEmulatorFromPath(newerLichii!.dir)).toBe('lichii')

      // 3. detectEmulatorFromPath recognizes Longshot, Hookshot, and ProjectReLink/ReLink segments
      expect(detectEmulatorFromPath(gamesLongshotSlot)).toBe('longshot')
      expect(
        detectEmulatorFromPath(path.join(tmpRoot, 'Games', 'Hookshot', 'user', 'save', uid, 'slot_00')),
      ).toBe('longshot')
      expect(
        detectEmulatorFromPath(path.join(tmpRoot, 'Games', 'HeyListen', 'user', 'save', uid, 'slot_00')),
      ).toBe('longshot')
      expect(
        detectEmulatorFromPath(
          path.join(tmpRoot, 'Games', 'ProjectReLink', 'game', 'user', 'save', uid, 'slot_00'),
        ),
      ).toBe('relink')
      expect(
        detectEmulatorFromPath(path.join(tmpRoot, 'Games', 'ReLink', 'user', 'save', uid, 'slot_00')),
      ).toBe('relink')
      expect(
        detectEmulatorFromPath(path.join(tmpRoot, 'Games', 'Triforce', 'user', 'save', uid, 'slot_00')),
      ).toBe('triforce')
    } finally {
      homeSpy.mockRestore()
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('supports NX2Saria <game>/profile/save/<32-hex-uid>/slot_00/caption.sav via NX2SARIA_SAVE_DIR', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nx2saria-save-test-'))
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpRoot)
    try {
      const uid = '0123456789abcdef0123456789abcdef'
      const appDataDir = path.join(tmpRoot, 'appdata')
      const xdgDataDir = path.join(tmpRoot, 'xdg-data')
      const profileDir = path.join(tmpRoot, 'game', 'profile')
      const accountDir = path.join(profileDir, 'save', uid)
      const slotDir = path.join(accountDir, 'slot_00')
      fs.mkdirSync(slotDir, { recursive: true })
      fs.mkdirSync(path.join(accountDir, 'slot_01'), { recursive: true })
      fs.writeFileSync(path.join(slotDir, 'caption.sav'), Buffer.alloc(0x30))
      fs.writeFileSync(path.join(accountDir, 'account.sav'), Buffer.alloc(0x10))
      fs.writeFileSync(path.join(accountDir, 'option.sav'), Buffer.alloc(0x10))

      // 1. NX2SARIA_SAVE_DIR may point at either the profile folder or its save folder
      for (const saveDir of [profileDir, path.join(profileDir, 'save')]) {
        const found = findLatestSaveSlotDir(
          getCandidateSaveDirs({ APPDATA: appDataDir, XDG_DATA_HOME: xdgDataDir, NX2SARIA_SAVE_DIR: saveDir }),
        )
        expect(found?.dir).toBe(slotDir)
      }

      // 2. Slots under NX2SARIA_SAVE_DIR are labeled nx2saria; sibling folders and unset env are not
      expect(detectEmulatorFromPath(slotDir, { NX2SARIA_SAVE_DIR: profileDir })).toBe('nx2saria')
      expect(detectEmulatorFromPath(slotDir, { NX2SARIA_SAVE_DIR: ` ${path.join(profileDir, 'save')} ` })).toBe(
        'nx2saria',
      )
      expect(
        detectEmulatorFromPath(path.join(tmpRoot, 'game', 'profile2', 'save', uid, 'slot_00'), {
          NX2SARIA_SAVE_DIR: profileDir,
        }),
      ).toBeUndefined()
      expect(detectEmulatorFromPath(slotDir, {})).toBeUndefined()
    } finally {
      homeSpy.mockRestore()
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('discovers Linux XDG_DATA_HOME and ~/.local/share save slots while honoring explicit *_SAVE_DIR overrides', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-xdg-save-test-'))
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpRoot)
    try {
      const appDataDir = path.join(tmpRoot, 'appdata')
      const xdgDataDir = path.join(tmpRoot, 'xdg-data')

      // 1. Default ~/.local/share/<emu>/nand/user/save/0000000000000000 discovery
      const localShareCheezySlot = path.join(
        tmpRoot,
        '.local',
        'share',
        'cheezyemu',
        'nand',
        'user',
        'save',
        '0000000000000000',
        '0000000000000001',
        '0400486024DEC000',
        'slot_00',
      )
      fs.mkdirSync(localShareCheezySlot, { recursive: true })
      const localShareCap = path.join(localShareCheezySlot, 'caption.sav')
      fs.writeFileSync(localShareCap, Buffer.alloc(0x30))
      fs.utimesSync(localShareCap, new Date(4000), new Date(4000))

      const fallbackFound = findLatestSaveSlotDir(getCandidateSaveDirs({ APPDATA: appDataDir }))
      expect(fallbackFound?.dir).toBe(localShareCheezySlot)
      expect(detectEmulatorFromPath(fallbackFound!.dir)).toBe('cheezyemu')

      // 2. Explicit XDG_DATA_HOME compares mtime cleanly across Linux XDG and Windows APPDATA defaults
      const xdgEdenSlot = path.join(
        xdgDataDir,
        'eden',
        'nand',
        'user',
        'save',
        '0000000000000000',
        '0000000000000001',
        '0400486024DEC000',
        'slot_00',
      )
      const appDataLichiiSlot = path.join(
        appDataDir,
        'lichii',
        'nand',
        'user',
        'save',
        '0000000000000000',
        '0000000000000001',
        '0400486024DEC000',
        'slot_00',
      )
      fs.mkdirSync(xdgEdenSlot, { recursive: true })
      fs.mkdirSync(appDataLichiiSlot, { recursive: true })
      const xdgEdenCap = path.join(xdgEdenSlot, 'caption.sav')
      const appDataLichiiCap = path.join(appDataLichiiSlot, 'caption.sav')
      fs.writeFileSync(xdgEdenCap, Buffer.alloc(0x30))
      fs.writeFileSync(appDataLichiiCap, Buffer.alloc(0x30))

      fs.utimesSync(appDataLichiiCap, new Date(2000), new Date(2000))
      fs.utimesSync(xdgEdenCap, new Date(8000), new Date(8000))
      const newerXdgEden = findLatestSaveSlotDir(
        getCandidateSaveDirs({ APPDATA: appDataDir, XDG_DATA_HOME: xdgDataDir }),
      )
      expect(newerXdgEden?.dir).toBe(xdgEdenSlot)
      expect(detectEmulatorFromPath(newerXdgEden!.dir)).toBe('eden')

      // Newer APPDATA default wins over older XDG_DATA_HOME default (no shadowing)
      fs.utimesSync(appDataLichiiCap, new Date(12000), new Date(12000))
      const newerAppDataLichii = findLatestSaveSlotDir(
        getCandidateSaveDirs({ APPDATA: appDataDir, XDG_DATA_HOME: xdgDataDir }),
      )
      expect(newerAppDataLichii?.dir).toBe(appDataLichiiSlot)
      expect(detectEmulatorFromPath(newerAppDataLichii!.dir)).toBe('lichii')

      // 3. Explicit *_SAVE_DIR override beats both newer Windows APPDATA and Linux XDG_DATA_HOME saves
      const customSlot = path.join(tmpRoot, 'portable-fritchii', 'slot_01')
      fs.mkdirSync(customSlot, { recursive: true })
      const customCap = path.join(customSlot, 'caption.sav')
      fs.writeFileSync(customCap, Buffer.alloc(0x30))
      fs.utimesSync(customCap, new Date(1000), new Date(1000))

      const overrideFound = findLatestSaveSlotDir(
        getCandidateSaveDirs({
          APPDATA: appDataDir,
          XDG_DATA_HOME: xdgDataDir,
          FRITCHII_SAVE_DIR: customSlot,
        }),
      )
      expect(overrideFound?.dir).toBe(customSlot)
    } finally {
      homeSpy.mockRestore()
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('discovers HeyListen and Linux Wine, Steam, Flatpak, Bottles, Heroic, and Lutris save paths', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-containers-save-test-'))
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpRoot)
    try {
      const uid = 'C4D5E6F708192A3B4C5D6E7F8091A2B3'
      const writeSlotCap = (slotDir: string, mtimeMs: number) => {
        fs.mkdirSync(slotDir, { recursive: true })
        const capPath = path.join(slotDir, 'caption.sav')
        fs.writeFileSync(capPath, Buffer.alloc(0x30))
        fs.utimesSync(capPath, new Date(mtimeMs), new Date(mtimeMs))
      }

      // 1. HeyListen native ~/Games/HeyListen/user
      const heyListenSlot = path.join(tmpRoot, 'Games', 'HeyListen', 'user', 'save', uid, 'slot_00')
      writeSlotCap(heyListenSlot, 10000)

      // 2. Wine (~/.wine and WINEPREFIX)
      const wineLichiiSlot = path.join(
        tmpRoot,
        '.wine',
        'drive_c',
        'users',
        'player',
        'AppData',
        'Roaming',
        'lichii',
        'nand',
        'user',
        'save',
        '0000000000000000',
        '0000000000000001',
        '0400486024DEC000',
        'slot_00',
      )
      writeSlotCap(wineLichiiSlot, 12000)

      const customWinePrefix = path.join(tmpRoot, 'custom-wine-prefix')
      const winePrefixHeyListenSlot = path.join(
        customWinePrefix,
        'drive_c',
        'Games',
        'HeyListen',
        'user',
        'save',
        uid,
        'slot_00',
      )
      writeSlotCap(winePrefixHeyListenSlot, 14000)

      // 3. Steam (libraryfolders.vdf + compatdata/*/pfx)
      const steamRoot = path.join(tmpRoot, '.local', 'share', 'Steam')
      const secondarySteamLib = path.join(tmpRoot, 'SteamLibrary')
      fs.mkdirSync(path.join(steamRoot, 'steamapps'), { recursive: true })
      fs.writeFileSync(
        path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
        `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steamRoot.replace(/\\/g, '\\\\')}"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${secondarySteamLib.replace(/\\/g, '\\\\')}"\n\t}\n}\n`,
      )
      const steamProtonSlot = path.join(
        secondarySteamLib,
        'steamapps',
        'compatdata',
        '987654321',
        'pfx',
        'drive_c',
        'users',
        'steamuser',
        'Games',
        'Longshot',
        'user',
        'save',
        uid,
        'slot_00',
      )
      writeSlotCap(steamProtonSlot, 16000)

      // 4. Flatpak (~/.var/app/*/{data,config})
      const flatpakEdenSlot = path.join(
        tmpRoot,
        '.var',
        'app',
        'dev.eden.Eden',
        'data',
        'eden',
        'nand',
        'user',
        'save',
        '0000000000000000',
        '0000000000000001',
        '0400486024DEC000',
        'slot_00',
      )
      writeSlotCap(flatpakEdenSlot, 18000)

      // 5. Bottles
      const bottlesFritchiiSlot = path.join(
        tmpRoot,
        '.local',
        'share',
        'bottles',
        'bottles',
        'Hyrule',
        'drive_c',
        'users',
        'steamuser',
        'AppData',
        'Roaming',
        'fritchii',
        'nand',
        'user',
        'save',
        '0000000000000000',
        '0000000000000001',
        '0400486024DEC000',
        'slot_00',
      )
      writeSlotCap(bottlesFritchiiSlot, 20000)

      // 6. Heroic
      const heroicSlot = path.join(
        tmpRoot,
        'Games',
        'Heroic',
        'Prefixes',
        'Ocarina',
        'drive_c',
        'Games',
        'Triforce',
        'user',
        'save',
        uid,
        'slot_00',
      )
      writeSlotCap(heroicSlot, 22000)

      // 7. Lutris (~/Games/<slug>/user)
      const lutrisSlot = path.join(tmpRoot, 'Games', 'ocarina-lutris', 'user', 'save', uid, 'slot_00')
      writeSlotCap(lutrisSlot, 24000)

      const env: NodeJS.ProcessEnv = {
        APPDATA: path.join(tmpRoot, 'appdata-empty'),
        WINEPREFIX: customWinePrefix,
      }
      const candidates = getCandidateSaveDirs(env)
      expect(candidates).toContain(path.resolve(path.join(tmpRoot, 'Games', 'HeyListen', 'user')))
      expect(candidates).toContain(
        path.resolve(
          path.join(
            tmpRoot,
            '.wine',
            'drive_c',
            'users',
            'player',
            'AppData',
            'Roaming',
            'lichii',
            'nand',
            'user',
            'save',
            '0000000000000000',
          ),
        ),
      )
      expect(candidates).toContain(
        path.resolve(path.join(customWinePrefix, 'drive_c', 'Games', 'HeyListen', 'user')),
      )
      expect(candidates).toContain(
        path.resolve(
          path.join(
            secondarySteamLib,
            'steamapps',
            'compatdata',
            '987654321',
            'pfx',
            'drive_c',
            'users',
            'steamuser',
            'Games',
            'Longshot',
            'user',
          ),
        ),
      )
      expect(candidates).toContain(
        path.resolve(
          path.join(
            tmpRoot,
            '.var',
            'app',
            'dev.eden.Eden',
            'data',
            'eden',
            'nand',
            'user',
            'save',
            '0000000000000000',
          ),
        ),
      )
      expect(candidates).toContain(
        path.resolve(
          path.join(
            tmpRoot,
            '.local',
            'share',
            'bottles',
            'bottles',
            'Hyrule',
            'drive_c',
            'users',
            'steamuser',
            'AppData',
            'Roaming',
            'fritchii',
            'nand',
            'user',
            'save',
            '0000000000000000',
          ),
        ),
      )
      expect(candidates).toContain(
        path.resolve(
          path.join(tmpRoot, 'Games', 'Heroic', 'Prefixes', 'Ocarina', 'drive_c', 'Games', 'Triforce', 'user'),
        ),
      )
      expect(candidates).toContain(path.resolve(path.join(tmpRoot, 'Games', 'ocarina-lutris', 'user')))

      // Newest across all Linux containers wins (Lutris at 24000)
      const latest = findLatestSaveSlotDir(candidates)
      expect(latest?.dir).toBe(lutrisSlot)

      // If Heroic is touched newer (30000), Heroic wins
      writeSlotCap(heroicSlot, 30000)
      const latestAfterHeroic = findLatestSaveSlotDir(candidates)
      expect(latestAfterHeroic?.dir).toBe(heroicSlot)
      expect(detectEmulatorFromPath(latestAfterHeroic!.dir)).toBe('triforce')

      // Explicit *_SAVE_DIR still overrides everything
      const explicitDir = path.join(tmpRoot, 'explicit-override', 'slot_00')
      writeSlotCap(explicitDir, 500)
      const explicitFound = findLatestSaveSlotDir(
        getCandidateSaveDirs({ ...env, LONGSHOT_SAVE_DIR: explicitDir }),
      )
      expect(explicitFound?.dir).toBe(explicitDir)
    } finally {
      homeSpy.mockRestore()
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('gives CUSTOM_SAVE_DIR highest priority in getCandidateSaveDirs() and resolves all 4 folder levels with availableSaveSlots', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-save-levels-'))
    const writeSlotCap = (slotDir: string, mtimeSec: number) => {
      fs.mkdirSync(slotDir, { recursive: true })
      const capPath = path.join(slotDir, 'caption.sav')
      fs.writeFileSync(capPath, Buffer.alloc(64))
      fs.utimesSync(capPath, mtimeSec, mtimeSec)
    }

    try {
      const customRoot = path.join(tmpRoot, 'custom-dir')
      const lichiiRoot = path.join(tmpRoot, 'lichii-dir')
      const candidates = getCandidateSaveDirs({
        CUSTOM_SAVE_DIR: customRoot,
        LICHII_SAVE_DIR: lichiiRoot,
      })
      expect(candidates[0]).toBe(path.resolve(customRoot))
      expect(candidates[1]).toBe(path.resolve(lichiiRoot))

      // Level 1a: Game install root -> user/save/<uid>/slot_*
      const heylistenRoot = path.join(tmpRoot, 'HeyListen')
      const heylistenProfile = path.join(heylistenRoot, 'user', 'save', 'a1b2c3d4e5f60718293a4b5c6d7e8f90')
      writeSlotCap(path.join(heylistenProfile, 'slot_02'), 1000)
      writeSlotCap(path.join(heylistenProfile, 'slot_00'), 2000)
      writeSlotCap(path.join(heylistenProfile, 'slot_01'), 1500)

      const l1Hey = resolveSaveSlotSelection(getCandidateSaveDirs({ CUSTOM_SAVE_DIR: heylistenRoot }), null)
      expect(l1Hey?.dir).toBe(path.join(heylistenProfile, 'slot_00'))
      expect(l1Hey?.profileDir).toBe(heylistenProfile)
      expect(l1Hey?.slotName).toBe('slot_00')
      expect(l1Hey?.availableSaveSlots).toEqual(['slot_00', 'slot_01', 'slot_02'])

      // Selecting an older valid slot returns that slot; invalid slot falls back to latest
      const l1Selected = resolveSaveSlotSelection(getCandidateSaveDirs({ CUSTOM_SAVE_DIR: heylistenRoot }), 'slot_02')
      expect(l1Selected?.dir).toBe(path.join(heylistenProfile, 'slot_02'))
      expect(l1Selected?.slotName).toBe('slot_02')
      const l1Invalid = resolveSaveSlotSelection(getCandidateSaveDirs({ CUSTOM_SAVE_DIR: heylistenRoot }), 'slot_99')
      expect(l1Invalid?.dir).toBe(path.join(heylistenProfile, 'slot_00'))

      // Level 1b: Longshot install root -> LongshotLauncher-data/user/save/<uid>/slot_*
      const longshotInstallRoot = path.join(tmpRoot, 'LONGSHOT')
      const longshotLauncherData = path.join(longshotInstallRoot, 'LongshotLauncher-data')
      const longshotProfile = path.join(longshotLauncherData, 'user', 'save', '11112222333344445555666677778888')
      writeSlotCap(path.join(longshotProfile, 'slot_00'), 1000)
      writeSlotCap(path.join(longshotProfile, 'slot_03'), 3000)
      expect(
        resolveSaveSlotSelection(getCandidateSaveDirs({ CUSTOM_SAVE_DIR: longshotInstallRoot }), null)?.dir,
      ).toBe(path.join(longshotProfile, 'slot_03'))
      expect(
        resolveSaveSlotSelection(getCandidateSaveDirs({ CUSTOM_SAVE_DIR: longshotLauncherData }), null)?.dir,
      ).toBe(path.join(longshotProfile, 'slot_03'))

      // Level 1c: OOT-PC root -> profile/save/<uid>/slot_*
      const ootPcRoot = path.join(tmpRoot, 'OOT-PC')
      const ootPcProfile = path.join(ootPcRoot, 'profile', 'save', 'fedcba9876543210fedcba9876543210')
      writeSlotCap(path.join(ootPcProfile, 'slot_01'), 4000)
      expect(
        resolveSaveSlotSelection(getCandidateSaveDirs({ CUSTOM_SAVE_DIR: ootPcRoot }), null)?.dir,
      ).toBe(path.join(ootPcProfile, 'slot_01'))

      // Level 2: user/save or profile/save folder
      expect(
        resolveSaveSlotSelection(
          getCandidateSaveDirs({ CUSTOM_SAVE_DIR: path.join(heylistenRoot, 'user', 'save') }),
          null,
        )?.availableSaveSlots,
      ).toEqual(['slot_00', 'slot_01', 'slot_02'])

      // Level 3: <uid> profile folder
      expect(
        resolveSaveSlotSelection(getCandidateSaveDirs({ CUSTOM_SAVE_DIR: heylistenProfile }), 'slot_01')?.dir,
      ).toBe(path.join(heylistenProfile, 'slot_01'))

      // Level 4: Direct slot_02 folder still exposes sibling slots in the resolved profile
      const directSlot02 = path.join(heylistenProfile, 'slot_02')
      const l4Direct = resolveSaveSlotSelection(getCandidateSaveDirs({ CUSTOM_SAVE_DIR: directSlot02 }), null)
      expect(l4Direct?.dir).toBe(directSlot02)
      expect(l4Direct?.profileDir).toBe(heylistenProfile)
      expect(l4Direct?.slotName).toBe('slot_02')
      expect(l4Direct?.availableSaveSlots).toEqual(['slot_00', 'slot_01', 'slot_02'])

      // Switching slot when CUSTOM_SAVE_DIR points to direct slot_02
      const l4Switched = resolveSaveSlotSelection(getCandidateSaveDirs({ CUSTOM_SAVE_DIR: directSlot02 }), 'slot_01')
      expect(l4Switched?.dir).toBe(path.join(heylistenProfile, 'slot_01'))
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('supports setSelectedSaveSlot(), setCustomSaveOverride(), and POST /api/saves/slot live switching', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'save-slot-api-'))
    const writeCaptionWithSkulltulas = (slotDir: string, skulltulaCount: number, mtimeSec: number) => {
      fs.mkdirSync(slotDir, { recursive: true })
      const cap = Buffer.alloc(64)
      cap.writeUInt32LE(0x38, 8) // dataOff
      cap.writeUInt32LE(0xdc941483, 0x28)
      cap.writeUInt32LE(skulltulaCount, 0x2c)
      const capPath = path.join(slotDir, 'caption.sav')
      fs.writeFileSync(capPath, cap)
      fs.utimesSync(capPath, mtimeSec, mtimeSec)
    }

    const invokeSaveSlotEndpoint = async (
      method: string,
      bodyText?: string,
      options?: { remoteAddress?: string | undefined; headers?: http.IncomingHttpHeaders },
    ) => {
      const stream = new PassThrough()
      const reqStream = stream as unknown as http.IncomingMessage
      reqStream.method = method
      reqStream.headers =
        options?.headers ?? (method === 'POST' ? { 'content-type': 'application/json' } : {})
      ;(reqStream as unknown as { socket: { remoteAddress?: string } }).socket = {
        remoteAddress: options && 'remoteAddress' in options ? options.remoteAddress : '127.0.0.1',
      }
      const chunks: Buffer[] = []
      let statusCode = 200
      const headers: Record<string, string | string[]> = {}
      const res = {
        setHeader(name: string, value: string | string[]) {
          headers[name.toLowerCase()] = value
        },
        writeHead(code: number, hdrs?: Record<string, string>) {
          statusCode = code
          if (hdrs) {
            for (const [k, v] of Object.entries(hdrs)) {
              headers[k.toLowerCase()] = v
            }
          }
          return this
        },
        end(chunk?: string | Buffer) {
          if (chunk) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        },
      } as unknown as http.ServerResponse

      const promise = handleSaveSlotApiRequest(reqStream, res, '/api/saves/slot')
      if (bodyText !== undefined) {
        stream.end(bodyText)
      } else {
        stream.end()
      }
      const handled = await promise
      return {
        handled,
        statusCode,
        headers,
        json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      }
    }

    const prevLichiiPort = process.env.LICHII_PORT
    closeLichiiRpc()
    process.env.LICHII_PORT = '1'
    try {
      const gameRoot = path.join(tmpRoot, 'HeyListen')
      const profileDir = path.join(gameRoot, 'user', 'save', 'abcdef0123456789abcdef0123456789')
      writeCaptionWithSkulltulas(path.join(profileDir, 'slot_00'), 12, 1000)
      writeCaptionWithSkulltulas(path.join(profileDir, 'slot_01'), 45, 2000)

      setCustomSaveOverride(gameRoot, null)
      const initial = await getLichiiTelemetryState()
      expect(initial.activeSaveDir).toBe(profileDir)
      expect(initial.activeSaveSlot).toBe('slot_01')
      expect(initial.availableSaveSlots).toEqual(['slot_00', 'slot_01'])
      expect(initial.skulltulaCount).toBe(45)

      setSelectedSaveSlot('slot_00')
      const switched = await getLichiiTelemetryState()
      expect(switched.activeSaveSlot).toBe('slot_00')
      expect(switched.skulltulaCount).toBe(12)

      // POST /api/saves/slot switches slot live
      const postRes = await invokeSaveSlotEndpoint('POST', JSON.stringify({ slot: 'slot_01' }))
      expect(postRes.handled).toBe(true)
      expect(postRes.statusCode).toBe(200)
      expect(postRes.json).toEqual({
        ok: true,
        activeSaveDir: profileDir,
        activeSaveSlot: 'slot_01',
        availableSaveSlots: ['slot_00', 'slot_01'],
      })

      // Non-POST returns 405
      const getRes = await invokeSaveSlotEndpoint('GET')
      expect(getRes.handled).toBe(true)
      expect(getRes.statusCode).toBe(405)

      // Invalid JSON returns 400
      const badJsonRes = await invokeSaveSlotEndpoint('POST', '{not-json')
      expect(badJsonRes.handled).toBe(true)
      expect(badJsonRes.statusCode).toBe(400)

      // Non-loopback client returns 403
      const lanRes = await invokeSaveSlotEndpoint('POST', JSON.stringify({ slot: 'slot_00' }), {
        remoteAddress: '192.168.1.42',
      })
      expect(lanRes.statusCode).toBe(403)

      // Missing remoteAddress returns 403
      const noAddrRes = await invokeSaveSlotEndpoint('POST', JSON.stringify({ slot: 'slot_00' }), {
        remoteAddress: undefined,
      })
      expect(noAddrRes.statusCode).toBe(403)

      // IPv6 loopback (::1) and IPv4-mapped loopback (::ffff:127.0.0.1) are allowed
      const ipv6Res = await invokeSaveSlotEndpoint('POST', JSON.stringify({ slot: 'slot_00' }), {
        remoteAddress: '::1',
      })
      expect(ipv6Res.statusCode).toBe(200)
      const mappedRes = await invokeSaveSlotEndpoint('POST', JSON.stringify({ slot: 'slot_01' }), {
        remoteAddress: '::ffff:127.0.0.1',
      })
      expect(mappedRes.statusCode).toBe(200)

      // Missing / wrong Content-Type returns 415
      const missingCtRes = await invokeSaveSlotEndpoint('POST', JSON.stringify({ slot: 'slot_00' }), {
        headers: {},
      })
      expect(missingCtRes.statusCode).toBe(415)

      // Cross-site Origin or Sec-Fetch-Site returns 403
      const crossOriginRes = await invokeSaveSlotEndpoint('POST', JSON.stringify({ slot: 'slot_00' }), {
        headers: {
          'content-type': 'application/json',
          host: '127.0.0.1:3000',
          origin: 'https://evil.example',
        },
      })
      expect(crossOriginRes.statusCode).toBe(403)

      const crossFetchRes = await invokeSaveSlotEndpoint('POST', JSON.stringify({ slot: 'slot_00' }), {
        headers: {
          'content-type': 'application/json',
          'sec-fetch-site': 'cross-site',
        },
      })
      expect(crossFetchRes.statusCode).toBe(403)

      // Windows UNC paths are rejected in both POST /api/saves/slot (400) and setCustomSaveOverride()
      for (const uncPath of ['\\\\evil-host\\share\\saves', '//evil-host/share/saves', '\\\\?\\UNC\\host\\share']) {
        expect(isUncSavePath(uncPath)).toBe(true)
        expect(() => setCustomSaveOverride(uncPath, null)).toThrow(TypeError)
        const uncRes = await invokeSaveSlotEndpoint('POST', JSON.stringify({ saveDir: uncPath }))
        expect(uncRes.statusCode).toBe(400)
      }
    } finally {
      closeLichiiRpc()
      if (prevLichiiPort === undefined) {
        delete process.env.LICHII_PORT
      } else {
        process.env.LICHII_PORT = prevLichiiPort
      }
      setCustomSaveOverride(null, null)
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('redacts activeSaveDir for non-loopback requests and preserves full path for loopback', () => {
    const winState = {
      connected: false,
      emulatorRunning: false,
      scene: null,
      placeId: null,
      placeSlug: null,
      placeName: null,
      mapId: null,
      age: null,
      position: null,
      mapFraction: null,
      worldMapFraction: null,
      skulltulaCount: null,
      collectedSkulltulaIds: [],
      authoritativeSkulltulas: false,
      lastCollectedSkulltulaId: null,
      lastPickedItem: null,
      source: 'save' as const,
      updatedAt: 1,
      activeSaveDir: 'C:\\Users\\alice\\AppData\\Roaming\\lichii\\save\\profile01',
    }

    const loopbackReq = { socket: { remoteAddress: '127.0.0.1' } } as http.IncomingMessage
    const remoteReq = { socket: { remoteAddress: '192.168.1.99' } } as http.IncomingMessage

    expect(isLoopbackRequest(loopbackReq)).toBe(true)
    expect(isLoopbackRequest(remoteReq)).toBe(false)

    expect(sanitizeTelemetryStateForRequest(winState, loopbackReq).activeSaveDir).toBe(
      'C:\\Users\\alice\\AppData\\Roaming\\lichii\\save\\profile01',
    )
    expect(sanitizeTelemetryStateForRequest(winState, remoteReq).activeSaveDir).toBe('profile01')

    const posixState = { ...winState, activeSaveDir: '/home/alice/.local/share/longshot/' }
    expect(redactTelemetryStateForRemote(posixState).activeSaveDir).toBe('longshot')
  })

  it('caps SSE stream clients at MAX_SSE_CLIENTS and returns 503 when full', () => {
    const openClients: Array<{ req: PassThrough; res: PassThrough; statusCode: number }> = []

    const openStream = (remoteAddress = '127.0.0.1') => {
      const req = new PassThrough()
      ;(req as unknown as { socket: { remoteAddress: string } }).socket = { remoteAddress }
      const res = new PassThrough()
      let statusCode = 0
      const mockRes = Object.assign(res, {
        writeHead(code: number) {
          statusCode = code
          return mockRes
        },
        flushHeaders() {},
      })
      handleLichiiStreamRequest(req as unknown as http.IncomingMessage, mockRes as unknown as http.ServerResponse)
      return { req, res, statusCode }
    }

    try {
      for (let i = 0; i < MAX_SSE_CLIENTS; i++) {
        const client = openStream('127.0.0.1')
        expect(client.statusCode).toBe(200)
        openClients.push(client)
      }

      // Exceeding MAX_SSE_CLIENTS returns 503.
      const rejected = openStream('192.168.1.55')
      expect(rejected.statusCode).toBe(503)

      // Closing one active client frees a slot.
      openClients.pop()?.req.emit('close')
      const replacement = openStream('127.0.0.1')
      expect(replacement.statusCode).toBe(200)
      openClients.push(replacement)
    } finally {
      for (const client of openClients) {
        client.req.emit('close')
      }
    }
  })

  it('wires LichiiRpcClient to LICHII_HOST and LICHII_PORT when options are omitted', async () => {
    const serverSockets = new Set<net.Socket>()
    const server = net.createServer((sock) => {
      serverSockets.add(sock)
      sock.on('close', () => serverSockets.delete(sock))
      let buf = ''
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        let nl = buf.indexOf('\n')
        while (nl !== -1) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (line.trim()) {
            const parsed = JSON.parse(line) as { id: number }
            sock.write(JSON.stringify({ id: parsed.id, result: { powered_on: true } }) + '\n')
          }
          nl = buf.indexOf('\n')
        }
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as net.AddressInfo
    const prevHost = process.env.LICHII_HOST
    const prevPort = process.env.LICHII_PORT
    const client = new LichiiRpcClient()

    try {
      process.env.LICHII_HOST = '127.0.0.1'
      process.env.LICHII_PORT = String(addr.port)
      expect(client.getHost()).toBe('127.0.0.1')
      expect(client.getPort()).toBe(addr.port)

      const res = await client.call('status', { fps_window_ms: 0 }, 500)
      expect(res).toEqual({ powered_on: true })
      expect(client.isConnected()).toBe(true)
    } finally {
      client.close()
      if (prevHost === undefined) delete process.env.LICHII_HOST
      else process.env.LICHII_HOST = prevHost
      if (prevPort === undefined) delete process.env.LICHII_PORT
      else process.env.LICHII_PORT = prevPort
      for (const s of serverSockets) s.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('KNOWN_SKULLTULA_HASH_MAP', () => {
  it('covers all 100 Gold Skulltulas uniquely and maps Spirit Temple GS-02 vs GS-04 accurately', () => {
    const allGsInDataset = new Set(dataset.items.filter((i) => i.cat === 'gs').map((i) => i.id))
    const seenIds = new Set<string>()
    const seenHashes = new Set<bigint>()

    for (const entry of KNOWN_SKULLTULA_HASH_MAP) {
      for (const id of entry.itemIds) {
        expect(allGsInDataset.has(id)).toBe(true)
        expect(seenIds.has(id)).toBe(false)
        seenIds.add(id)
      }
      for (const h of entry.hashes) {
        expect(seenHashes.has(h)).toBe(false)
        seenHashes.add(h)
      }
    }

    expect(seenIds.size).toBe(100)
    expect(seenHashes.size).toBe(200)

    const gs02 = KNOWN_SKULLTULA_HASH_MAP.find((e) => e.itemIds.includes('espiritu-gs-02'))
    const gs04 = KNOWN_SKULLTULA_HASH_MAP.find((e) => e.itemIds.includes('espiritu-gs-04'))
    expect(gs02?.hashes).toContain(0xb3d9f353599eea51n)
    expect(gs04?.hashes).toContain(0x70b0fca66ca48088n)

    const lonlon02 = KNOWN_SKULLTULA_HASH_MAP.find((e) => e.itemIds.includes('lonlon-gs-02'))
    const lonlon04 = KNOWN_SKULLTULA_HASH_MAP.find((e) => e.itemIds.includes('lonlon-gs-04'))
    expect(lonlon02?.hashes).toContain(0x7d8ec14bdd1f6341n)
    expect(lonlon04?.hashes).toContain(0x25e6072d4df023b3n)
  })
})

describe('parseMasterFlagTableBuffer', () => {
  function buildSortedTable(
    collectedItemIds: Set<string>,
    heartContainerFlags?: Map<bigint, bigint>,
  ): Buffer {
    const records: Array<{ hash: bigint; flags: bigint }> = [
      { hash: 0x00006e56f79838e8n, flags: 0x18n },
      { hash: 0x00006e56f79838ean, flags: 0x0700000000000058n },
    ]
    for (const entry of KNOWN_SKULLTULA_HASH_MAP) {
      const collected = entry.itemIds.some((id) => collectedItemIds.has(id))
      const flags = collected ? 0x0002000100000018n : 0x18n
      for (const h of entry.hashes) {
        records.push({ hash: h, flags })
      }
    }
    if (heartContainerFlags) {
      for (const [hash, flags] of heartContainerFlags) {
        records.push({ hash, flags })
      }
    }
    records.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
    const buf = Buffer.alloc(records.length * 16)
    records.forEach((rec, idx) => {
      buf.writeBigUInt64LE(rec.hash, idx * 16)
      buf.writeBigUInt64LE(rec.flags, idx * 16 + 8)
    })
    return buf
  }

  it('extracts exact collected Skulltulas without marking roommates', () => {
    const buf = buildSortedTable(new Set(['espiritu-gs-01', 'espiritu-gs-02']))
    const parsed = parseMasterFlagTableBuffer(buf)
    expect(parsed).not.toBeNull()
    expect(parsed?.presentItemIds.size).toBe(100)
    expect(parsed?.collectedItemIds).toEqual(['espiritu-gs-01', 'espiritu-gs-02'])
    expect(parsed?.collectedHeartContainerIds).toEqual([])
    expect(parsed?.collectedHeartPieceIds).toEqual([])
  })

  it('detects all 8 Dungeon Heart Containers when 0x100000000n is set and omits when unset', () => {
    expect(KNOWN_HEART_CONTAINER_HASH_MAP).toHaveLength(8)
    const allContainerIds = KNOWN_HEART_CONTAINER_HASH_MAP.flatMap((e) => e.itemIds)
    expect(new Set(allContainerIds).size).toBe(8)

    const allDatasetIds = new Set(
      dataset.items.filter((i) => i.cat === 'container').map((i) => i.id),
    )
    for (const id of allContainerIds) {
      expect(allDatasetIds.has(id)).toBe(true)
    }

    const collectedFlags = new Map<bigint, bigint>()
    const uncollectedFlags = new Map<bigint, bigint>()
    for (const entry of KNOWN_HEART_CONTAINER_HASH_MAP) {
      for (const h of entry.hashes) {
        collectedFlags.set(h, 0x0002000100000018n)
        uncollectedFlags.set(h, 0x0000000000000018n)
      }
    }

    const parsedCollected = parseMasterFlagTableBuffer(
      buildSortedTable(new Set(['espiritu-gs-01']), collectedFlags),
    )
    expect(parsedCollected).not.toBeNull()
    expect(parsedCollected?.collectedItemIds).toEqual(['espiritu-gs-01'])
    expect(parsedCollected?.collectedHeartContainerIds).toEqual([...allContainerIds].sort())

    const parsedUncollected = parseMasterFlagTableBuffer(
      buildSortedTable(new Set(['espiritu-gs-01']), uncollectedFlags),
    )
    expect(parsedUncollected).not.toBeNull()
    expect(parsedUncollected?.collectedItemIds).toEqual(['espiritu-gs-01'])
    expect(parsedUncollected?.collectedHeartContainerIds).toEqual([])
  })

  it('detects all 14 Type 0 freestanding Heart Pieces when 0x100000000n is set and omits when unset', () => {
    expect(KNOWN_HEART_PIECE_HASH_MAP).toHaveLength(14)
    const allHpIds = KNOWN_HEART_PIECE_HASH_MAP.flatMap((e) => e.itemIds)
    expect(new Set(allHpIds).size).toBe(14)

    const heartItems = new Set(
      dataset.items.filter((i) => i.cat === 'heart').map((i) => i.id),
    )
    for (const id of allHpIds) {
      expect(heartItems.has(id)).toBe(true)
    }

    const collectedFlags = new Map<bigint, bigint>()
    const uncollectedFlags = new Map<bigint, bigint>()
    for (const entry of KNOWN_HEART_PIECE_HASH_MAP) {
      for (const h of entry.hashes) {
        collectedFlags.set(h, 0x0002000100000018n)
        uncollectedFlags.set(h, 0x0000000000000018n)
      }
    }

    const parsedCollected = parseMasterFlagTableBuffer(buildSortedTable(new Set(), collectedFlags))
    expect(parsedCollected).not.toBeNull()
    expect(parsedCollected?.collectedHeartPieceIds).toEqual([...allHpIds].sort())

    const parsedUncollected = parseMasterFlagTableBuffer(
      buildSortedTable(new Set(), uncollectedFlags),
    )
    expect(parsedUncollected).not.toBeNull()
    expect(parsedUncollected?.collectedHeartPieceIds).toEqual([])
  })

  it('returns null on bad header or incomplete table', () => {
    expect(parseMasterFlagTableBuffer(Buffer.alloc(64))).toBeNull()
    const partial = Buffer.alloc(32)
    partial.writeBigUInt64LE(0x00006e56f79838e8n, 0)
    partial.writeBigUInt64LE(0x00006e56f79838ean, 16)
    expect(parseMasterFlagTableBuffer(partial)).toBeNull()
  })
})

describe('Type 1/2 SaveBuf Sec 1 Heart Piece bools', () => {
  it('covers all 22 remaining Heart Pieces in dataset (including Dampe race & Gerudo bridge chests) with no overlap with Master Flag Table', () => {
    expect(KNOWN_HEART_PIECE_BOOL_HASH_MAP).toHaveLength(22)
    const boolIds = KNOWN_HEART_PIECE_BOOL_HASH_MAP.map((e) => e.itemId)
    const boolHashes = KNOWN_HEART_PIECE_BOOL_HASH_MAP.map((e) => e.hash >>> 0)
    expect(new Set(boolIds).size).toBe(22)
    expect(new Set(boolHashes).size).toBe(22)
    expect(KNOWN_HEART_PIECE_BOOL_HASH_MAP).toEqual(
      expect.arrayContaining([
        { hash: 0x8331e107, itemId: 'cementerio-heart-02' },
        { hash: 0x7001f17c, itemId: 'valle-heart-02' },
      ]),
    )

    const masterHpIds = new Set(KNOWN_HEART_PIECE_HASH_MAP.flatMap((e) => e.itemIds))
    for (const id of boolIds) {
      expect(masterHpIds.has(id)).toBe(false)
    }
    expect(masterHpIds.size + boolIds.length).toBe(36)

    const heartItems = new Set(
      dataset.items.filter((i) => i.cat === 'heart').map((i) => i.id),
    )
    for (const id of boolIds) {
      expect(heartItems.has(id)).toBe(true)
    }
  })

  it('parseSaveBufHeartPieceBoolRange verifies hashes and extracts collected Type 2 Heart Pieces', () => {
    const minOff = 0x100
    const offsets = new Map<number, number>()
    const rangeBuf = Buffer.alloc(KNOWN_HEART_PIECE_BOOL_HASH_MAP.length * 16)

    KNOWN_HEART_PIECE_BOOL_HASH_MAP.forEach((entry, idx) => {
      const rel = idx * 16
      offsets.set(entry.hash >>> 0, minOff + rel)
      rangeBuf.writeUInt32LE(entry.hash >>> 0, rel)
      // Mark even indices collected (1), odd indices uncollected (0)
      rangeBuf.writeUInt32LE(idx % 2 === 0 ? 1 : 0, rel + 4)
    })

    const expectedCollected = KNOWN_HEART_PIECE_BOOL_HASH_MAP.filter((_, idx) => idx % 2 === 0)
      .map((e) => e.itemId)
      .sort()
    expect(parseSaveBufHeartPieceBoolRange(rangeBuf, minOff, offsets)).toEqual(expectedCollected)

    // Corrupting a cached u32 hash must return null so caller triggers a re-scan
    const corrupted = Buffer.from(rangeBuf)
    corrupted.writeUInt32LE(0xdeadbeef, 0)
    expect(parseSaveBufHeartPieceBoolRange(corrupted, minOff, offsets)).toBeNull()
  })

  it('parseSaveSlot collects all 16 Type 2 bools from progress.sav Sec 1 and 64-bit hashes from 0xa3db7114', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lichii-hp-save-'))
    try {
      const slotDir = path.join(tmpRoot, 'slot_00')
      fs.mkdirSync(slotDir, { recursive: true })

      // Build synthetic progress.sav:
      // 0x28 header + 16 Sec 1 entries + 1 section boundary (h=0,v=1) + 1 Sec 2 ptr (0xa3db7114) + data blob
      const sec1Entries = KNOWN_HEART_PIECE_BOOL_HASH_MAP.length
      const dirStart = 0x28
      const dirEntryCount = sec1Entries + 2 // +1 sentinel, +1 0xa3db7114 ptr
      const dataOff = dirStart + dirEntryCount * 8
      const blobHashes = [0x88358af5b5300aa9n, 0x292e3ed6acacbe44n, 0xf914fa367471a3e3n]
      const prog = Buffer.alloc(dataOff + blobHashes.length * 8)
      prog.writeUInt32LE(dataOff, 8)

      let off = dirStart
      for (const entry of KNOWN_HEART_PIECE_BOOL_HASH_MAP) {
        prog.writeUInt32LE(entry.hash >>> 0, off)
        prog.writeUInt32LE(1, off + 4)
        off += 8
      }
      // Sentinel advancing sec from 1 to 2 (INPLACE_SECTIONS has 1, not 2)
      prog.writeUInt32LE(0, off)
      prog.writeUInt32LE(1, off + 4)
      off += 8

      // 0xa3db7114 pointer entry
      prog.writeUInt32LE(0xa3db7114, off)
      prog.writeUInt32LE(dataOff, off + 4)

      blobHashes.forEach((h, i) => {
        prog.writeBigUInt64LE(h, dataOff + i * 8)
      })

      fs.writeFileSync(path.join(slotDir, 'progress.sav'), prog)
      const parsed = parseSaveSlot({ dir: slotDir, key: `hp-test-${Date.now()}`, mtimeMs: 1234 })
      expect(parsed).not.toBeNull()
      expect(parsed?.savedHeartPieceBoolIds).toEqual(
        KNOWN_HEART_PIECE_BOOL_HASH_MAP.map((e) => e.itemId).sort(),
      )
      for (const h of blobHashes) {
        expect(parsed?.savedHashes.has(h)).toBe(true)
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})

describe('SaveBuf Sec 1 & Sec 3 Beans, Great Fairies, and Bottles', () => {
  it('covers all 10 beans, 6 great fairies, 5 bottles, and 19 fairy thoughts in dataset with unique hashes', () => {
    expect(KNOWN_BEAN_BOOL_HASH_MAP).toHaveLength(10)
    expect(KNOWN_FAIRY_BOOL_HASH_MAP).toHaveLength(6)
    expect(KNOWN_BOTTLE_BOOL_HASH_MAP).toHaveLength(4)
    expect(KNOWN_THOUGHT_BOOL_HASH_MAP).toHaveLength(22)

    const allSec1Entries = [
      ...KNOWN_HEART_PIECE_BOOL_HASH_MAP,
      ...KNOWN_BEAN_BOOL_HASH_MAP,
      ...KNOWN_FAIRY_BOOL_HASH_MAP,
      ...KNOWN_BOTTLE_BOOL_HASH_MAP,
      ...KNOWN_THOUGHT_BOOL_HASH_MAP,
    ]
    expect(new Set(allSec1Entries.map((e) => e.hash >>> 0)).size).toBe(64)
    expect(new Set(allSec1Entries.map((e) => e.hash >>> 0)).has(GHOST_SHOP_COUPON_NUM_HASH >>> 0)).toBe(
      false,
    )

    const beanItems = new Set(dataset.items.filter((i) => i.cat === 'bean').map((i) => i.id))
    const fairyItems = new Set(dataset.items.filter((i) => i.cat === 'fairy').map((i) => i.id))
    const bottleItems = new Set(dataset.items.filter((i) => i.cat === 'bottle').map((i) => i.id))
    const thoughtItems = new Set(dataset.items.filter((i) => i.cat === 'thought').map((i) => i.id))

    expect(KNOWN_BEAN_BOOL_HASH_MAP.map((e) => e.itemId).sort()).toEqual([...beanItems].sort())
    expect(
      KNOWN_BEAN_BOOL_HASH_MAP.map((e) => [e.hash >>> 0, e.itemId]),
    ).toEqual([
      [0xb55acadd, 'kokiri-bean-01'],
      [0x5ebf7c8b, 'perdido-bean-01'],
      [0x610eb13c, 'perdido-bean-02'],
      [0x274b7e3d, 'cementerio-bean-01'],
      [0xf2ceba92, 'sendero-bean-01'],
      [0x562fab76, 'crater-bean-01'],
      [0x5eea40a6, 'rio-bean-01'],
      [0xb0377637, 'lago-bean-01'],
      [0x50a1775e, 'valle-bean-01'],
      [0x2a1c58ce, 'coloso-bean-01'],
    ])
    expect(KNOWN_FAIRY_BOOL_HASH_MAP.map((e) => e.itemId).sort()).toEqual([...fairyItems].sort())
    const mappedBottleIds = [
      ...KNOWN_BOTTLE_BOOL_HASH_MAP.map((e) => e.itemId),
      GHOST_SHOP_COUPON_BOTTLE_ITEM_ID,
    ].sort()
    expect(mappedBottleIds).toEqual([...bottleItems].sort())
    expect(Array.from(new Set(KNOWN_THOUGHT_BOOL_HASH_MAP.map((e) => e.itemId))).sort()).toEqual(
      [...thoughtItems].sort(),
    )
    expect(KNOWN_THOUGHT_BOOL_HASH_MAP.map((e) => [e.hash >>> 0, e.itemId])).toEqual([
      [0x2e9d02ca, 'cementerio-thought-01'],
      [0x444057da, 'cementerio-thought-02'],
      [0xbb7912c6, 'coloso-thought-01'],
      [0x304c49c8, 'hielo-thought-01'],
      [0x8b8f3a34, 'lago-thought-01'],
      [0xea520731, 'llanura-thought-01'],
      [0x668de3c8, 'llanura-thought-02'],
      [0x74f0b017, 'llanura-thought-03'],
      [0x8199eea2, 'llanura-thought-03'],
      [0xda186a0e, 'llanura-thought-03'],
      [0x61b1d5c1, 'llanura-thought-03'],
      [0x8e8f3ae5, 'llanura-thought-04'],
      [0x00f5171f, 'llanura-thought-05'],
      [0x151ed981, 'llanura-thought-06'],
      [0xed1a38ad, 'llanura-thought-07'],
      [0x4ac77991, 'llanura-thought-08'],
      [0x87917159, 'llanura-thought-09'],
      [0x80dffa7d, 'llanura-thought-10'],
      [0x494cf2ac, 'lonlon-thought-01'],
      [0xd74884be, 'pozo-thought-01'],
      [0x39885d67, 'sendero-thought-01'],
      [0xa2c78425, 'sombra-thought-01'],
    ])
  })

  it('parseSaveBufCollectibleRange extracts beans, fairies, bottles, thoughts and handles GhostShop_CouponNum 499 vs 500', () => {
    const allHashes = [
      ...KNOWN_HEART_PIECE_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_BEAN_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_FAIRY_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_BOTTLE_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_THOUGHT_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      GHOST_SHOP_COUPON_NUM_HASH >>> 0,
    ]
    const minOff = 0x100
    const offsets = new Map<number, number>()
    const rangeBuf = Buffer.alloc(allHashes.length * 16)

    allHashes.forEach((h, idx) => {
      const rel = idx * 16
      offsets.set(h, minOff + rel)
      rangeBuf.writeUInt32LE(h, rel)
      rangeBuf.writeUInt32LE(h === (GHOST_SHOP_COUPON_NUM_HASH >>> 0) ? 499 : 1, rel + 4)
    })

    const belowThreshold = parseSaveBufCollectibleRange(rangeBuf, minOff, offsets)
    expect(belowThreshold).not.toBeNull()
    expect(belowThreshold?.heartPieceIds).toEqual(
      KNOWN_HEART_PIECE_BOOL_HASH_MAP.map((e) => e.itemId).sort(),
    )
    expect(belowThreshold?.beanIds).toEqual(KNOWN_BEAN_BOOL_HASH_MAP.map((e) => e.itemId).sort())
    expect(belowThreshold?.fairyIds).toEqual(KNOWN_FAIRY_BOOL_HASH_MAP.map((e) => e.itemId).sort())
    expect(belowThreshold?.bottleIds).toEqual(
      KNOWN_BOTTLE_BOOL_HASH_MAP.map((e) => e.itemId).sort(),
    )
    expect(belowThreshold?.thoughtIds).toEqual(
      Array.from(new Set(KNOWN_THOUGHT_BOOL_HASH_MAP.map((e) => e.itemId))).sort(),
    )

    // Set GhostShop_CouponNum to 500 -> ciudadela-bottle-01 is awarded
    const couponRel = (allHashes.length - 1) * 16
    rangeBuf.writeInt32LE(500, couponRel + 4)
    const atThreshold = parseSaveBufCollectibleRange(rangeBuf, minOff, offsets)
    expect(atThreshold?.bottleIds).toEqual(
      [...KNOWN_BOTTLE_BOOL_HASH_MAP.map((e) => e.itemId), GHOST_SHOP_COUPON_BOTTLE_ITEM_ID].sort(),
    )

    // Corrupting any cached hash must return null
    const corrupted = Buffer.from(rangeBuf)
    corrupted.writeUInt32LE(0xdeadbeef, 0)
    expect(parseSaveBufCollectibleRange(corrupted, minOff, offsets)).toBeNull()
  })

  it('parseSaveSlot collects all 10 beans, 6 fairies, 5 bottles, and 19 fairy thoughts from progress.sav (499 vs 500)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lichii-collectibles-save-'))
    try {
      const slotDir = path.join(tmpRoot, 'slot_00')
      fs.mkdirSync(slotDir, { recursive: true })

      const buildProgress = (couponScore: number) => {
        const sec1Entries = [
          ...KNOWN_BEAN_BOOL_HASH_MAP,
          ...KNOWN_FAIRY_BOOL_HASH_MAP,
          ...KNOWN_BOTTLE_BOOL_HASH_MAP,
          ...KNOWN_THOUGHT_BOOL_HASH_MAP,
        ]
        const dirStart = 0x28
        // Sec 1 entries + sentinel (sec=3) + Sec 3 GhostShop_CouponNum
        const dirEntryCount = sec1Entries.length + 2
        const dataOff = dirStart + dirEntryCount * 8
        const prog = Buffer.alloc(dataOff)
        prog.writeUInt32LE(dataOff, 8)

        let off = dirStart
        for (const entry of sec1Entries) {
          prog.writeUInt32LE(entry.hash >>> 0, off)
          prog.writeUInt32LE(1, off + 4)
          off += 8
        }
        // Sentinel advancing sec from 1 to 3 (v = 2 -> sec = 3)
        prog.writeUInt32LE(0, off)
        prog.writeUInt32LE(2, off + 4)
        off += 8

        // Sec 3 GhostShop_CouponNum
        prog.writeUInt32LE(GHOST_SHOP_COUPON_NUM_HASH >>> 0, off)
        prog.writeInt32LE(couponScore, off + 4)
        return prog
      }

      fs.writeFileSync(path.join(slotDir, 'progress.sav'), buildProgress(499))
      const parsed499 = parseSaveSlot({
        dir: slotDir,
        key: `collectibles-499-${Date.now()}`,
        mtimeMs: 1000,
      })
      expect(parsed499?.savedBeanIds).toEqual(KNOWN_BEAN_BOOL_HASH_MAP.map((e) => e.itemId).sort())
      expect(parsed499?.savedFairyIds).toEqual(
        KNOWN_FAIRY_BOOL_HASH_MAP.map((e) => e.itemId).sort(),
      )
      expect(parsed499?.savedBottleIds).toEqual(
        KNOWN_BOTTLE_BOOL_HASH_MAP.map((e) => e.itemId).sort(),
      )
      expect(parsed499?.savedThoughtIds).toEqual(
        Array.from(new Set(KNOWN_THOUGHT_BOOL_HASH_MAP.map((e) => e.itemId))).sort(),
      )

      fs.writeFileSync(path.join(slotDir, 'progress.sav'), buildProgress(500))
      const parsed500 = parseSaveSlot({
        dir: slotDir,
        key: `collectibles-500-${Date.now()}`,
        mtimeMs: 2000,
      })
      expect(parsed500?.savedBottleIds).toEqual(
        [...KNOWN_BOTTLE_BOOL_HASH_MAP.map((e) => e.itemId), GHOST_SHOP_COUPON_BOTTLE_ITEM_ID].sort(),
      )
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})

describe('reconcileSkulltulaLists', () => {
  it('unmarks Skulltulas missing from a reloaded save while keeping hearts and uncollected reveals', () => {
    const res = reconcileSkulltulaLists({
      doneList: ['espiritu-heart-01', 'espiritu-gs-01', 'espiritu-gs-02', 'coloso-gs-03'],
      revealedList: ['espiritu-gs-01', 'espiritu-gs-02', 'espiritu-gs-05', 'coloso-gs-03'],
      collectedIds: ['espiritu-gs-01', 'espiritu-gs-03'],
      authoritative: true,
    })

    expect(res.nextDone).toEqual(['espiritu-heart-01', 'espiritu-gs-01', 'espiritu-gs-03'])
    // Uncollected GS that were previously done (gs-02, coloso-gs-03) are unrevealed; manually revealed uncollected gs-05 stays
    expect(res.nextRevealed).toEqual(['espiritu-gs-01', 'espiritu-gs-05', 'espiritu-gs-03'])
    expect(res.addedIds).toEqual(['espiritu-gs-03'])
    expect(res.removedIds).toEqual(['espiritu-gs-02', 'coloso-gs-03'])
    expect(res.doneChanged).toBe(true)
    expect(res.revealedChanged).toBe(true)
  })

  it('does not unmark anything when authoritative is false', () => {
    const res = reconcileSkulltulaLists({
      doneList: ['espiritu-gs-01', 'espiritu-gs-02'],
      revealedList: ['espiritu-gs-01', 'espiritu-gs-02'],
      collectedIds: ['espiritu-gs-01'],
      authoritative: false,
    })

    expect(res.nextDone).toEqual(['espiritu-gs-01', 'espiritu-gs-02'])
    expect(res.removedIds).toEqual([])
    expect(res.doneChanged).toBe(false)
  })
})

describe('deriveConnectionStatus', () => {
  it('returns connected: false when tcpConnected is false even if saveState is present', () => {
    expect(
      deriveConnectionStatus({
        tcpConnected: false,
        emulatorRunning: false,
        hasLivePosition: false,
        hasSavePosition: true,
      }),
    ).toEqual({
      connected: false,
      emulatorRunning: false,
      source: 'save',
    })

    // Even if stale live flags were passed while TCP is down, connected & emulatorRunning stay false
    expect(
      deriveConnectionStatus({
        tcpConnected: false,
        emulatorRunning: true,
        hasLivePosition: true,
        hasSavePosition: true,
      }),
    ).toEqual({
      connected: false,
      emulatorRunning: false,
      source: 'save',
    })

    expect(
      deriveConnectionStatus({
        tcpConnected: false,
        emulatorRunning: false,
        hasLivePosition: false,
        hasSavePosition: false,
      }),
    ).toEqual({
      connected: false,
      emulatorRunning: false,
      source: 'none',
    })
  })

  it('returns connected: true when tcpConnected is true across save, title-screen, and live memory states', () => {
    expect(
      deriveConnectionStatus({
        tcpConnected: true,
        emulatorRunning: false,
        hasLivePosition: false,
        hasSavePosition: true,
      }),
    ).toEqual({
      connected: true,
      emulatorRunning: false,
      source: 'save',
    })

    expect(
      deriveConnectionStatus({
        tcpConnected: true,
        emulatorRunning: true,
        hasLivePosition: false,
        hasSavePosition: true,
      }),
    ).toEqual({
      connected: true,
      emulatorRunning: true,
      source: 'save',
    })

    expect(
      deriveConnectionStatus({
        tcpConnected: true,
        emulatorRunning: true,
        hasLivePosition: true,
        hasSavePosition: true,
      }),
    ).toEqual({
      connected: true,
      emulatorRunning: true,
      source: 'memory',
    })
  })
})

describe('deriveLastPickedItem', () => {
  it('suppresses stale disk lastPickedItem in live memory mode and keeps it in save mode', () => {
    expect(deriveLastPickedItem('memory', 'Item_Token_Gold')).toBeNull()
    expect(deriveLastPickedItem('save', 'Item_Token_Gold')).toBe('Item_Token_Gold')
    expect(deriveLastPickedItem('none', null)).toBeNull()
  })
})

describe('Sub[36] and GameDataMgr RAM validators', () => {
  it('validates Sub[36] double-vtable and finite non-zero coordinates', () => {
    const valid = Buffer.alloc(0x40)
    valid.writeBigUInt64LE(0x84fce818n, 0)
    valid.writeBigUInt64LE(0x84311f8cn, 8)
    valid.writeFloatLE(13.6, 0x1c)
    valid.writeFloatLE(114.15, 0x20)
    valid.writeFloatLE(-64.9, 0x24)
    expect(isValidSub36Buffer(valid)).toBe(true)

    const wrongVt = Buffer.from(valid)
    wrongVt.writeBigUInt64LE(0x1234n, 0)
    expect(isValidSub36Buffer(wrongVt)).toBe(false)

    const zeroPos = Buffer.from(valid)
    zeroPos.writeFloatLE(0, 0x1c)
    zeroPos.writeFloatLE(0, 0x20)
    zeroPos.writeFloatLE(0, 0x24)
    expect(isValidSub36Buffer(zeroPos)).toBe(false)

    const outOfRange = Buffer.from(valid)
    outOfRange.writeFloatLE(20000, 0x1c)
    expect(isValidSub36Buffer(outOfRange)).toBe(false)
    expect(isValidSub36Buffer(null)).toBe(false)
  })

  it('validates GameDataMgr StockNum vtable, tag 8, and 0..100 range', () => {
    const buf = Buffer.alloc(0x30)
    buf.writeBigUInt64LE(0x8504de98n, 0)
    buf.writeUInt32LE(8, 8)
    buf.writeUInt32LE(46, 0x20)
    expect(parseGdmSkulltulaCount(buf)).toBe(46)

    const wrongTag = Buffer.from(buf)
    wrongTag.writeUInt32LE(7, 8)
    expect(parseGdmSkulltulaCount(wrongTag)).toBeNull()

    const wrongVt = Buffer.from(buf)
    wrongVt.writeBigUInt64LE(0xdeadbeefn, 0)
    expect(parseGdmSkulltulaCount(wrongVt)).toBeNull()

    const badCount = Buffer.from(buf)
    badCount.writeUInt32LE(101, 0x20)
    expect(parseGdmSkulltulaCount(badCount)).toBeNull()
  })

  it('validates Switch NSO main_base header and derives ASLR-adjusted vtables', () => {
    const validHdr = Buffer.alloc(16)
    validHdr.writeUInt32LE(1, 0)
    validHdr.writeUInt32LE(0x03c4705c, 4)
    expect(validateMainBaseHeader(validHdr)).toBe(true)

    const badMagic = Buffer.from(validHdr)
    badMagic.writeUInt32LE(2, 0)
    expect(validateMainBaseHeader(badMagic)).toBe(false)

    const badMod0 = Buffer.from(validHdr)
    badMod0.writeUInt32LE(0x03c47050, 4)
    expect(validateMainBaseHeader(badMod0)).toBe(false)

    expect(validateMainBaseHeader(Buffer.alloc(4))).toBe(false)
    expect(validateMainBaseHeader(null)).toBe(false)

    expect(deriveDynamicVtables(0x80c9a000n)).toEqual({
      sub36Vt1: 0x8583b818n,
      sub36Vt2: 0x84b7ef8cn,
      pObjVt: 0x8583c7c8n,
      gdmVt: 0x858f2270n,
      gdmBoolVt: 0x858ba658n,
      gdmStockVt: 0x858ba718n,
      gdmCountVt: 0x858bae98n,
    })

    // Also reproduces legacy session (+0 vs +0x86d000 ASLR slide)
    const legacyVtables = deriveDynamicVtables(0x8042d000n)
    expect(legacyVtables.sub36Vt1).toBe(0x84fce818n)
    expect(legacyVtables.sub36Vt2).toBe(0x84311f8cn)
    expect(legacyVtables.gdmCountVt).toBe(0x8504de98n)
  })

  it('validates Sub[36] and GameDataMgr structs with dynamic slid vtables', () => {
    const vtables = deriveDynamicVtables(0x80c9a000n)

    const slidSub36 = Buffer.alloc(0x40)
    slidSub36.writeBigUInt64LE(0x8583b818n, 0)
    slidSub36.writeBigUInt64LE(0x84b7ef8cn, 8)
    slidSub36.writeFloatLE(0.3, 0x1c)
    slidSub36.writeFloatLE(114.15, 0x20)
    slidSub36.writeFloatLE(-56.47, 0x24)
    expect(isValidSub36Buffer(slidSub36)).toBe(false)
    expect(isValidSub36Buffer(slidSub36, vtables.sub36Vt1, vtables.sub36Vt2)).toBe(true)

    const slidGdmCount = Buffer.alloc(0x30)
    slidGdmCount.writeBigUInt64LE(0x858bae98n, 0)
    slidGdmCount.writeUInt32LE(8, 8)
    slidGdmCount.writeUInt32LE(45, 0x20)
    expect(parseGdmSkulltulaCount(slidGdmCount)).toBeNull()
    expect(parseGdmSkulltulaCount(slidGdmCount, vtables.gdmCountVt)).toBe(45)

    const slidGdmStock = Buffer.alloc(0x28)
    slidGdmStock.writeBigUInt64LE(vtables.gdmStockVt, 0)
    slidGdmStock.writeUInt32LE(0x20, 8)
    slidGdmStock.writeUInt32LE(45, 0x1c)
    slidGdmStock.writeUInt32LE(45, 0x20)
    expect(parseGdmStockNumBuffer(slidGdmStock, vtables.gdmStockVt)).toBe(45)
    expect(parseGdmStockNumBuffer(slidGdmStock, 0xdeadbeefn)).toBeNull()

    const badStockTag = Buffer.from(slidGdmStock)
    badStockTag.writeUInt32LE(8, 8)
    expect(parseGdmStockNumBuffer(badStockTag, vtables.gdmStockVt)).toBeNull()
  })
})

describe('Live GameDataMgr +0x170 Bool & +0x230 Int containers', () => {
  it('parseGdmContainerHeader validates gdm + 0x170 Bool container dimensions and rejects invalid headers', () => {
    const hdr = Buffer.alloc(0x28)
    hdr.writeUInt32LE(11292, 0x08)
    hdr.writeBigUInt64LE(0x218551d418n, 0x10)
    hdr.writeBigUInt64LE(0x21854f1258n, 0x18)
    hdr.writeUInt32LE(22584, 0x24)

    expect(parseGdmContainerHeader(hdr)).toEqual({
      cnt: 11292,
      entriesPtr: 0x218551d418n,
      hashTablePtr: 0x21854f1258n,
      cap: 22584,
    })

    const badCap = Buffer.from(hdr)
    badCap.writeUInt32LE(100, 0x24)
    expect(parseGdmContainerHeader(badCap)).toBeNull()

    const badPtr = Buffer.from(hdr)
    badPtr.writeBigUInt64LE(0x1000n, 0x10)
    expect(parseGdmContainerHeader(badPtr)).toBeNull()

    const boundaryPtr = Buffer.from(hdr)
    boundaryPtr.writeBigUInt64LE(0x1000000000n, 0x10)
    expect(parseGdmContainerHeader(boundaryPtr)).toBeNull()

    const longshotHdr = Buffer.from(hdr)
    longshotHdr.writeBigUInt64LE(0x118551d418n, 0x10)
    longshotHdr.writeBigUInt64LE(0x11854f1258n, 0x18)
    expect(parseGdmContainerHeader(longshotHdr)).toEqual({
      cnt: 11292,
      entriesPtr: 0x118551d418n,
      hashTablePtr: 0x11854f1258n,
      cap: 22584,
    })

    expect(parseGdmContainerHeader(Buffer.alloc(0x20))).toBeNull()
    expect(parseGdmContainerHeader(null)).toBeNull()
  })

  it('scanGdmContainerHashTableBuffer resolves all 55 Bool entries (0x18 stride) and GhostShop_CouponNum (0x28 stride)', () => {
    const allBoolHashes = [
      ...KNOWN_HEART_PIECE_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_BEAN_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_FAIRY_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_BOTTLE_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_THOUGHT_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
    ]
    const boolTargetSet = new Set(allBoolHashes)
    const entriesPtr = 0x218551d418n
    const cnt = 11292

    // Include an out-of-range idx entry that must be ignored, plus all 55 valid entries
    const hashBuf = Buffer.alloc((allBoolHashes.length + 1) * 8)
    hashBuf.writeUInt32LE(0x2a1c58ce, 0)
    hashBuf.writeUInt32LE(cnt, 4) // idx === cnt -> out of range, must be ignored

    allBoolHashes.forEach((h, i) => {
      const off = (i + 1) * 8
      hashBuf.writeUInt32LE(h, off)
      // Use idx=9240 for coloso-bean-01 (0x2a1c58ce) to match live memory layout
      const idx = h === 0x2a1c58ce ? 9240 : 9000 + i
      hashBuf.writeUInt32LE(idx, off + 4)
    })

    const boolAddrs = scanGdmContainerHashTableBuffer(
      hashBuf,
      cnt,
      boolTargetSet,
      entriesPtr,
      0x18n,
    )
    expect(boolAddrs.size).toBe(64)
    expect(boolAddrs.get(0x2a1c58ce)).toBe(entriesPtr + 9240n * 0x18n)
    expect(boolAddrs.has(0x8e8f3ae5)).toBe(true)

    // Int container GhostShop_CouponNum (0xe3407cee, idx=822, 0x28 stride)
    const intEntriesPtr = 0x2185600000n
    const intHashBuf = Buffer.alloc(16)
    intHashBuf.writeUInt32LE(0x11223344, 0)
    intHashBuf.writeUInt32LE(10, 4)
    intHashBuf.writeUInt32LE(GHOST_SHOP_COUPON_NUM_HASH >>> 0, 8)
    intHashBuf.writeUInt32LE(822, 12)

    const intAddrs = scanGdmContainerHashTableBuffer(
      intHashBuf,
      2000,
      new Set([GHOST_SHOP_COUPON_NUM_HASH >>> 0]),
      intEntriesPtr,
      0x28n,
    )
    expect(intAddrs.get(GHOST_SHOP_COUPON_NUM_HASH >>> 0)).toBe(intEntriesPtr + 822n * 0x28n)
  })

  it('parseGdmBoolEntryBuffer and parseGdmIntEntryBuffer validate vtables and read +0x16 / +0x1c values', () => {
    const vtables = deriveDynamicVtables(0x80075000n)
    expect(vtables.gdmBoolVt).toBe(0x84c95658n)
    expect(vtables.gdmStockVt).toBe(0x84c95718n)

    // Two 0x18-byte Bool entries in one coalesced buffer: [false, true]
    const boolBuf = Buffer.alloc(0x30)
    boolBuf.writeBigUInt64LE(vtables.gdmBoolVt, 0x00)
    boolBuf.writeUInt8(0, 0x16)
    boolBuf.writeBigUInt64LE(vtables.gdmBoolVt, 0x18)
    boolBuf.writeUInt8(1, 0x18 + 0x16)

    expect(parseGdmBoolEntryBuffer(boolBuf, vtables.gdmBoolVt, 0x00)).toBe(false)
    expect(parseGdmBoolEntryBuffer(boolBuf, vtables.gdmBoolVt, 0x18)).toBe(true)
    expect(parseGdmBoolEntryBuffer(boolBuf, 0xdeadbeefn, 0x18)).toBeNull()
    expect(parseGdmBoolEntryBuffer(boolBuf.subarray(0, 0x17), vtables.gdmBoolVt, 0)).toBeNull()

    // 0x28-byte Int entry for GhostShop_CouponNum at +0x1c
    const intBuf = Buffer.alloc(0x28)
    intBuf.writeBigUInt64LE(vtables.gdmStockVt, 0x00)
    intBuf.writeInt32LE(499, 0x1c)
    expect(parseGdmIntEntryBuffer(intBuf, vtables.gdmStockVt)).toBe(499)

    intBuf.writeInt32LE(500, 0x1c)
    expect(parseGdmIntEntryBuffer(intBuf, vtables.gdmStockVt)).toBe(500)
    expect(parseGdmIntEntryBuffer(intBuf, 0xdeadbeefn)).toBeNull()
    expect(parseGdmIntEntryBuffer(intBuf.subarray(0, 0x20), vtables.gdmStockVt)).toBeNull()
  })

  it('classifyGdmCollectibles maps all 55 Bool entries and GhostShop_CouponNum threshold (499 vs 500)', () => {
    const boolValues = new Map<number, boolean>()
    for (const e of KNOWN_HEART_PIECE_BOOL_HASH_MAP) boolValues.set(e.hash >>> 0, false)
    for (const e of KNOWN_BEAN_BOOL_HASH_MAP) boolValues.set(e.hash >>> 0, false)
    for (const e of KNOWN_FAIRY_BOOL_HASH_MAP) boolValues.set(e.hash >>> 0, false)
    for (const e of KNOWN_BOTTLE_BOOL_HASH_MAP) boolValues.set(e.hash >>> 0, false)
    for (const e of KNOWN_THOUGHT_BOOL_HASH_MAP) boolValues.set(e.hash >>> 0, false)

    boolValues.set(0x2a1c58ce, true) // coloso-bean-01
    boolValues.set(0x8fa2608e, true) // castillo-fairy-01
    boolValues.set(0x7a7961c3, true) // kakariko-bottle-01
    boolValues.set(0x5ff7aa30, true) // perdido-heart-01
    boolValues.set(0x8e8f3ae5, true) // llanura-thought-04

    expect(classifyGdmCollectibles(boolValues, 499)).toEqual({
      heartPieceIds: ['perdido-heart-01'],
      beanIds: ['coloso-bean-01'],
      fairyIds: ['castillo-fairy-01'],
      bottleIds: ['kakariko-bottle-01'],
      thoughtIds: ['llanura-thought-04'],
    })

    expect(classifyGdmCollectibles(boolValues, 500)).toEqual({
      heartPieceIds: ['perdido-heart-01'],
      beanIds: ['coloso-bean-01'],
      fairyIds: ['castillo-fairy-01'],
      bottleIds: [GHOST_SHOP_COUPON_BOTTLE_ITEM_ID, 'kakariko-bottle-01'].sort(),
      thoughtIds: ['llanura-thought-04'],
    })

    expect(classifyGdmCollectibles(boolValues, null)).toBeNull()
    boolValues.delete(0x2a1c58ce)
    expect(classifyGdmCollectibles(boolValues, 500)).toBeNull()
  })

  it('detects llanura-thought-03 from Child-age Note12_1 (0x8199eea2) alone and deduplicates multiple Note12* flags', () => {
    const makeAllFalse = () => {
      const m = new Map<number, boolean>()
      for (const e of KNOWN_HEART_PIECE_BOOL_HASH_MAP) m.set(e.hash >>> 0, false)
      for (const e of KNOWN_BEAN_BOOL_HASH_MAP) m.set(e.hash >>> 0, false)
      for (const e of KNOWN_FAIRY_BOOL_HASH_MAP) m.set(e.hash >>> 0, false)
      for (const e of KNOWN_BOTTLE_BOOL_HASH_MAP) m.set(e.hash >>> 0, false)
      for (const e of KNOWN_THOUGHT_BOOL_HASH_MAP) m.set(e.hash >>> 0, false)
      return m
    }

    const childOnly = makeAllFalse()
    childOnly.set(0x8199eea2, true) // HaveReadHrlField_Note12_1
    expect(classifyGdmCollectibles(childOnly, 0)?.thoughtIds).toEqual(['llanura-thought-03'])

    const both = makeAllFalse()
    both.set(0x74f0b017, true) // HaveReadHrlField_Note12
    both.set(0x8199eea2, true) // HaveReadHrlField_Note12_1
    expect(classifyGdmCollectibles(both, 0)?.thoughtIds).toEqual(['llanura-thought-03'])

    // Also verify parseSaveBufCollectibleRange deduplicates when both flags are set
    const allHashes = [
      ...KNOWN_HEART_PIECE_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_BEAN_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_FAIRY_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_BOTTLE_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_THOUGHT_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      GHOST_SHOP_COUPON_NUM_HASH >>> 0,
    ]
    const minOff = 0x100
    const offsets = new Map<number, number>()
    const rangeBuf = Buffer.alloc(allHashes.length * 8)
    allHashes.forEach((h, idx) => {
      const rel = idx * 8
      offsets.set(h, minOff + rel)
      rangeBuf.writeUInt32LE(h, rel)
      const val = h === 0x74f0b017 || h === 0x8199eea2 ? 1 : 0
      rangeBuf.writeUInt32LE(val, rel + 4)
    })
    expect(parseSaveBufCollectibleRange(rangeBuf, minOff, offsets)?.thoughtIds).toEqual([
      'llanura-thought-03',
    ])
  })
})

describe('LichiiRpcClient', () => {
  it('clears pending calls, updates isConnected(), and invokes onDisconnect when socket drops', async () => {
    const serverSockets = new Set<net.Socket>()
    let reqCount = 0
    const server = net.createServer((sock) => {
      serverSockets.add(sock)
      sock.on('close', () => serverSockets.delete(sock))
      let buf = ''
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        let nl = buf.indexOf('\n')
        while (nl !== -1) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (line.trim()) {
            const parsed = JSON.parse(line) as { id: number }
            reqCount += 1
            if (reqCount === 1) {
              sock.write(JSON.stringify({ id: parsed.id, result: { powered_on: true } }) + '\n')
            } else {
              // Simulate emulator closing mid-flight before replying
              sock.destroy()
            }
          }
          nl = buf.indexOf('\n')
        }
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as net.AddressInfo
    const onDisconnect = vi.fn()
    const client = new LichiiRpcClient({
      host: '127.0.0.1',
      port: addr.port,
      onDisconnect,
    })

    try {
      expect(client.isConnected()).toBe(false)
      const first = await client.call('status', { fps_window_ms: 0 }, 500)
      expect(first).toEqual({ powered_on: true })
      expect(client.isConnected()).toBe(true)
      expect(onDisconnect).not.toHaveBeenCalled()

      // Queue two calls, then server destroys socket on the first of them
      const inFlight = client.call('read_memory', { address: '0x216054bda8', size: 64 }, 500)
      const queued = client.call('read_memory', { address: '0x2185af3620', size: 48 }, 500)
      const [r1, r2] = await Promise.all([inFlight, queued])

      expect(r1).toBeNull()
      expect(r2).toBeNull()
      expect(client.isConnected()).toBe(false)
      expect(onDisconnect).toHaveBeenCalledTimes(1)
    } finally {
      for (const s of serverSockets) s.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('clears isConnected() and invokes onDisconnect immediately when idle socket closes', async () => {
    const serverSockets = new Set<net.Socket>()
    const server = net.createServer((sock) => {
      serverSockets.add(sock)
      sock.on('close', () => serverSockets.delete(sock))
      let buf = ''
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        let nl = buf.indexOf('\n')
        while (nl !== -1) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (line.trim()) {
            const parsed = JSON.parse(line) as { id: number }
            sock.write(JSON.stringify({ id: parsed.id, result: { powered_on: true } }) + '\n')
          }
          nl = buf.indexOf('\n')
        }
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as net.AddressInfo
    const disconnected = new Promise<void>((resolve) => {
      const client = new LichiiRpcClient({
        host: '127.0.0.1',
        port: addr.port,
        onDisconnect: () => {
          expect(client.isConnected()).toBe(false)
          resolve()
        },
      })
      void client.call('status', { fps_window_ms: 0 }, 500).then((res) => {
        expect(res).toEqual({ powered_on: true })
        expect(client.isConnected()).toBe(true)
        for (const s of serverSockets) s.destroy()
      })
    })

    try {
      await disconnected
    } finally {
      for (const s of serverSockets) s.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('Longshot live .bss telemetry resolution (getLichiiTelemetryState)', () => {
  const MAIN_MOD0_OFFSET = 0x03c4705cn
  const MAIN_MOD0_PATTERN_HEX = '4d4f44305467030124fb0f016c342501'
  const MAIN_SUB6_BSS_OFFSET = 0x04e6c7a8n
  const MAIN_SUB24_BSS_OFFSET = 0x04e6c938n
  const MAIN_GDM_BSS_OFFSET = 0x04e90ce8n
  const GDM_STOCK_TOKEN_HASH = 0x04735978

  function buildMasterFlagTable(options: {
    collectedSkulltulaIds: Set<string>
    collectedHeartContainerIds?: Set<string>
    collectedHeartPieceIds?: Set<string>
  }): { buf: Buffer; count: number } {
    const records: Array<{ hash: bigint; flags: bigint }> = [
      { hash: 0x00006e56f79838e8n, flags: 0x18n },
      { hash: 0x00006e56f79838ean, flags: 0x0700000000000058n },
    ]
    const categories: Array<{
      entries: Array<{ hashes: bigint[]; itemIds: string[] }>
      collected?: Set<string>
    }> = [
      { entries: KNOWN_SKULLTULA_HASH_MAP, collected: options.collectedSkulltulaIds },
      { entries: KNOWN_HEART_CONTAINER_HASH_MAP, collected: options.collectedHeartContainerIds },
      { entries: KNOWN_HEART_PIECE_HASH_MAP, collected: options.collectedHeartPieceIds },
    ]
    for (const { entries, collected } of categories) {
      for (const entry of entries) {
        const isCollected = entry.itemIds.some((id) => collected?.has(id))
        const flags = isCollected ? 0x0002000100000018n : 0x18n
        for (const h of entry.hashes) {
          records.push({ hash: h, flags })
        }
      }
    }
    records.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
    const buf = Buffer.alloc(records.length * 16)
    records.forEach((rec, idx) => {
      buf.writeBigUInt64LE(rec.hash, idx * 16)
      buf.writeBigUInt64LE(rec.flags, idx * 16 + 8)
    })
    return { buf, count: records.length }
  }

  function createLongshotMemoryRegions(config: {
    mainBase: bigint
    useSub24Bss?: boolean
    sub6OverridePtr?: bigint
    subSingletonPtr: bigint
    pObjPtr: bigint
    subArrPtr: bigint
    sub7Ptr: bigint
    sub23Ptr: bigint
    sub36Ptr: bigint
    gdmPtr: bigint
    boolEntriesPtr: bigint
    boolHashTablePtr: bigint
    intEntriesPtr: bigint
    intHashTablePtr: bigint
    masterTablePtr: bigint
    scenePath: string
    x: number
    y: number
    z: number
    skulltulaCount: number
    couponCount: number
    collectedSkulltulaIds: Set<string>
    collectedHeartContainerIds: Set<string>
    collectedMasterHeartPieceIds: Set<string>
    collectedBoolHashes: Set<number>
  }): Array<{ base: bigint; buf: Buffer }> {
    const vtables = deriveDynamicVtables(config.mainBase)

    const mainHdr = Buffer.alloc(16)
    mainHdr.writeUInt32LE(1, 0)
    mainHdr.writeUInt32LE(Number(MAIN_MOD0_OFFSET), 4)

    const sub6Bss = Buffer.alloc(8)
    sub6Bss.writeBigUInt64LE(
      config.sub6OverridePtr ?? (config.useSub24Bss ? 0n : config.subSingletonPtr),
      0,
    )

    const sub24Bss = Buffer.alloc(8)
    sub24Bss.writeBigUInt64LE(config.useSub24Bss ? config.subSingletonPtr : 0n, 0)

    const gdmBss = Buffer.alloc(8)
    gdmBss.writeBigUInt64LE(config.gdmPtr, 0)

    const subSingleton = Buffer.alloc(0x18)
    subSingleton.writeBigUInt64LE(config.pObjPtr, 0x10)

    const subCount = 40
    const pObj = Buffer.alloc(0x60)
    pObj.writeBigUInt64LE(vtables.pObjVt, 0x00)
    pObj.writeUInt32LE(subCount, 0x50)
    pObj.writeBigUInt64LE(config.subArrPtr, 0x58)

    const subArr = Buffer.alloc(subCount * 8)
    subArr.writeBigUInt64LE(config.sub7Ptr, 7 * 8)
    subArr.writeBigUInt64LE(config.sub23Ptr, 23 * 8)
    subArr.writeBigUInt64LE(config.sub36Ptr, 36 * 8)

    const sub36 = Buffer.alloc(0x40)
    sub36.writeBigUInt64LE(vtables.sub36Vt1, 0x00)
    sub36.writeBigUInt64LE(vtables.sub36Vt2, 0x08)
    sub36.writeBigUInt64LE(config.pObjPtr, 0x10)
    sub36.writeFloatLE(config.x, 0x1c)
    sub36.writeFloatLE(config.y, 0x20)
    sub36.writeFloatLE(config.z, 0x24)
    sub36.writeFloatLE(0.0, 0x28)
    sub36.writeFloatLE(-1.0, 0x30)

    const sub7 = Buffer.alloc(0xb4)
    sub7.write(config.scenePath + '\0', 0x34, 'ascii')

    const sub23 = Buffer.alloc(0x100)
    sub23.write('Link_Child\0', 0x80, 'ascii')

    const allBoolHashes = [
      ...KNOWN_HEART_PIECE_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_BEAN_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_FAIRY_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_BOTTLE_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_THOUGHT_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
    ]
    const boolHashTable = Buffer.alloc(allBoolHashes.length * 8)
    const boolEntries = Buffer.alloc(allBoolHashes.length * 0x18)
    allBoolHashes.forEach((h, idx) => {
      boolHashTable.writeUInt32LE(h, idx * 8)
      boolHashTable.writeUInt32LE(idx, idx * 8 + 4)

      const entryOff = idx * 0x18
      boolEntries.writeBigUInt64LE(vtables.gdmBoolVt, entryOff)
      boolEntries.writeUInt8(config.collectedBoolHashes.has(h) ? 1 : 0, entryOff + 0x16)
    })

    const intHashTable = Buffer.alloc(16)
    intHashTable.writeUInt32LE(GDM_STOCK_TOKEN_HASH, 0)
    intHashTable.writeUInt32LE(0, 4)
    intHashTable.writeUInt32LE(GHOST_SHOP_COUPON_NUM_HASH >>> 0, 8)
    intHashTable.writeUInt32LE(1, 12)

    const intEntries = Buffer.alloc(2 * 0x28)
    intEntries.writeBigUInt64LE(vtables.gdmStockVt, 0x00)
    intEntries.writeUInt32LE(0x20, 0x08)
    intEntries.writeUInt32LE(config.skulltulaCount, 0x1c)
    intEntries.writeBigUInt64LE(vtables.gdmStockVt, 0x28)
    intEntries.writeInt32LE(config.couponCount, 0x28 + 0x1c)

    const masterTable = buildMasterFlagTable({
      collectedSkulltulaIds: config.collectedSkulltulaIds,
      collectedHeartContainerIds: config.collectedHeartContainerIds,
      collectedHeartPieceIds: config.collectedMasterHeartPieceIds,
    })

    const gdm = Buffer.alloc(0xdd0)
    gdm.writeBigUInt64LE(vtables.gdmVt, 0x00)
    // +0x170 Bool container header
    gdm.writeUInt32LE(allBoolHashes.length, 0x170 + 0x08)
    gdm.writeBigUInt64LE(config.boolEntriesPtr, 0x170 + 0x10)
    gdm.writeBigUInt64LE(config.boolHashTablePtr, 0x170 + 0x18)
    gdm.writeUInt32LE(allBoolHashes.length, 0x170 + 0x24)
    // +0x230 Int container header
    gdm.writeUInt32LE(2, 0x230 + 0x08)
    gdm.writeBigUInt64LE(config.intEntriesPtr, 0x230 + 0x10)
    gdm.writeBigUInt64LE(config.intHashTablePtr, 0x230 + 0x18)
    gdm.writeUInt32LE(2, 0x230 + 0x24)
    // +0xdc0 MasterFlagTable metadata
    gdm.writeBigUInt64LE(BigInt(masterTable.count), 0xdc0)
    gdm.writeBigUInt64LE(config.masterTablePtr, 0xdc8)

    return [
      { base: config.mainBase, buf: mainHdr },
      { base: config.mainBase + MAIN_SUB6_BSS_OFFSET, buf: sub6Bss },
      { base: config.mainBase + MAIN_SUB24_BSS_OFFSET, buf: sub24Bss },
      { base: config.mainBase + MAIN_GDM_BSS_OFFSET, buf: gdmBss },
      { base: config.subSingletonPtr, buf: subSingleton },
      { base: config.pObjPtr, buf: pObj },
      { base: config.subArrPtr, buf: subArr },
      { base: config.sub36Ptr, buf: sub36 },
      { base: config.sub7Ptr, buf: sub7 },
      { base: config.sub23Ptr, buf: sub23 },
      { base: config.gdmPtr, buf: gdm },
      { base: config.boolEntriesPtr, buf: boolEntries },
      { base: config.boolHashTablePtr, buf: boolHashTable },
      { base: config.intEntriesPtr, buf: intEntries },
      { base: config.intHashTablePtr, buf: intHashTable },
      { base: config.masterTablePtr, buf: masterTable.buf },
    ]
  }

  async function withMockLongshotRpcServer(
    mainBase: bigint,
    regions: Array<{ base: bigint; buf: Buffer }>,
    fn: (info: { searchPatterns: string[] }) => Promise<void>,
    emulator = 'longshot',
  ): Promise<void> {
    const serverSockets = new Set<net.Socket>()
    const searchPatterns: string[] = []
    const mod0AddrHex = '0x' + (mainBase + MAIN_MOD0_OFFSET).toString(16)

    const server = net.createServer((sock) => {
      serverSockets.add(sock)
      sock.on('close', () => serverSockets.delete(sock))
      let buf = ''
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        let nl = buf.indexOf('\n')
        while (nl !== -1) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (line.trim()) {
            const req = JSON.parse(line) as {
              id: number
              method: string
              params?: Record<string, unknown>
            }
            if (req.method === 'status') {
              sock.write(
                JSON.stringify({
                  id: req.id,
                  result: {
                    powered_on: true,
                    program_id: '0400486024DEC000',
                    emulator,
                  },
                }) + '\n',
              )
            } else if (req.method === 'search_memory') {
              const pattern = String(req.params?.pattern ?? '')
              searchPatterns.push(pattern)
              const hits = pattern === MAIN_MOD0_PATTERN_HEX ? [mod0AddrHex] : []
              sock.write(JSON.stringify({ id: req.id, result: { hits } }) + '\n')
            } else if (req.method === 'read_memory') {
              const addr = BigInt(String(req.params?.address ?? '0x0'))
              const size = Number(req.params?.size ?? 0)
              const region = regions.find(
                (r) => addr >= r.base && addr + BigInt(size) <= r.base + BigInt(r.buf.length),
              )
              if (region) {
                const startOff = Number(addr - region.base)
                const slice = region.buf.subarray(startOff, startOff + size)
                sock.write(
                  JSON.stringify({ id: req.id, result: { hex: slice.toString('hex') } }) + '\n',
                )
              } else {
                sock.write(JSON.stringify({ id: req.id, result: null }) + '\n')
              }
            } else {
              sock.write(JSON.stringify({ id: req.id, result: null }) + '\n')
            }
          }
          nl = buf.indexOf('\n')
        }
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as net.AddressInfo
    const prevHost = process.env.LICHII_HOST
    const prevPort = process.env.LICHII_PORT
    closeLichiiRpc()

    try {
      process.env.LICHII_HOST = '127.0.0.1'
      process.env.LICHII_PORT = String(addr.port)
      await fn({ searchPatterns })
    } finally {
      closeLichiiRpc()
      if (prevHost === undefined) delete process.env.LICHII_HOST
      else process.env.LICHII_HOST = prevHost
      if (prevPort === undefined) delete process.env.LICHII_PORT
      else process.env.LICHII_PORT = prevPort
      for (const s of serverSockets) s.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  it('resolves GameDataMgr and Player via .bss in Longshot 0x1000000000n..0x1fffffffffn heap range with emulator: "longshot"', async () => {
    const mainBase = 0x80000000n
    const regions = createLongshotMemoryRegions({
      mainBase,
      subSingletonPtr: 0x1100100000n,
      pObjPtr: 0x1100200000n,
      subArrPtr: 0x1100300000n,
      sub7Ptr: 0x1100400000n,
      sub23Ptr: 0x1100500000n,
      sub36Ptr: 0x1100600000n,
      gdmPtr: 0x1200000000n,
      intEntriesPtr: 0x1200100000n,
      intHashTablePtr: 0x1200200000n,
      boolEntriesPtr: 0x1400100000n,
      boolHashTablePtr: 0x1400200000n,
      masterTablePtr: 0x1f00000000n,
      scenePath: 'Work/Banc/Scene/HyruleCastle/HyruleCastle_Child.bcett.json',
      x: 13.49,
      y: 114.15,
      z: -14.0,
      skulltulaCount: 2,
      couponCount: 500,
      collectedSkulltulaIds: new Set(['castillo-gs-01', 'espiritu-gs-01']),
      collectedHeartContainerIds: new Set(['deku-heart-01']),
      collectedMasterHeartPieceIds: new Set(['lonlon-heart-01']),
      collectedBoolHashes: new Set([
        0x5ff7aa30, // perdido-heart-01
        0x2a1c58ce, // coloso-bean-01
        0x8fa2608e, // castillo-fairy-01
        0x7a7961c3, // kakariko-bottle-01
        0x8e8f3ae5, // llanura-thought-04
      ]),
    })

    await withMockLongshotRpcServer(mainBase, regions, async ({ searchPatterns }) => {
      const state = await getLichiiTelemetryState()
      expect(state.connected).toBe(true)
      expect(state.emulatorRunning).toBe(true)
      expect(state.emulator).toBe('longshot')
      expect(state.titleId).toBe('0400486024DEC000')
      expect(state.source).toBe('memory')
      expect(state.scene).toBe('HyruleCastle')
      expect(state.placeId).toBe('castillo')
      expect(state.mapId).toBe('nino')
      expect(state.age).toBe('child')
      expect(state.position).toEqual({ x: 13.49, y: 114.15, z: -14, yaw: 0 })
      expect(state.mapFraction).toEqual({ x: 0.4726, y: 0.8888 })
      expect(state.skulltulaCount).toBe(2)
      expect(state.collectedSkulltulaIds).toEqual(['castillo-gs-01', 'espiritu-gs-01'])
      expect(state.authoritativeSkulltulas).toBe(true)
      expect(state.collectedHeartContainerIds).toEqual(['deku-heart-01'])
      expect(state.authoritativeHeartContainers).toBe(true)
      expect(state.collectedHeartPieceIds).toEqual(['lonlon-heart-01', 'perdido-heart-01'])
      expect(state.authoritativeHeartPieces).toBe(true)
      expect(state.collectedBeanIds).toEqual(['coloso-bean-01'])
      expect(state.authoritativeBeans).toBe(true)
      expect(state.collectedFairyIds).toEqual(['castillo-fairy-01'])
      expect(state.authoritativeFairies).toBe(true)
      expect(state.collectedBottleIds).toEqual([GHOST_SHOP_COUPON_BOTTLE_ITEM_ID, 'kakariko-bottle-01'].sort())
      expect(state.authoritativeBottles).toBe(true)
      expect(state.collectedThoughtIds).toEqual(['llanura-thought-04'])
      expect(state.authoritativeThoughts).toBe(true)
      // Only MOD0 discovery ran search_memory; Player and GameDataMgr resolved directly via .bss
      expect(searchPatterns).toEqual([MAIN_MOD0_PATTERN_HEX])
    })
  })

  it('rejects pointers <= MIN_GUEST_HEAP_PTR (0x1000000000n) and resolves ASLR .bss via SUB24 in Longshot heap range', async () => {
    const mainBase = 0x80c9a000n
    const regions = createLongshotMemoryRegions({
      mainBase,
      useSub24Bss: true,
      sub6OverridePtr: 0x1000000000n, // Exact MIN_GUEST_HEAP_PTR boundary must be rejected
      subSingletonPtr: 0x1000001000n, // Strictly above MIN_GUEST_HEAP_PTR
      pObjPtr: 0x1080000000n,
      subArrPtr: 0x1080010000n,
      sub7Ptr: 0x1080020000n,
      sub23Ptr: 0x1080030000n,
      sub36Ptr: 0x1080040000n,
      gdmPtr: 0x1f00000000n,
      intEntriesPtr: 0x1f00100000n,
      intHashTablePtr: 0x1f00200000n,
      boolEntriesPtr: 0x1f10100000n,
      boolHashTablePtr: 0x1f10200000n,
      masterTablePtr: 0x1ff0000000n,
      scenePath: 'Work/Banc/Scene/KokiriForest/KokiriForest.bcett.json',
      x: 0.3,
      y: 12.5,
      z: -5.5,
      skulltulaCount: 1,
      couponCount: 499,
      collectedSkulltulaIds: new Set(['kokiri-gs-01']),
      collectedHeartContainerIds: new Set(),
      collectedMasterHeartPieceIds: new Set(),
      collectedBoolHashes: new Set(),
    })

    await withMockLongshotRpcServer(mainBase, regions, async ({ searchPatterns }) => {
      const state = await getLichiiTelemetryState()
      expect(state.connected).toBe(true)
      expect(state.emulatorRunning).toBe(true)
      expect(state.emulator).toBe('longshot')
      expect(state.source).toBe('memory')
      expect(state.scene).toBe('KokiriForest')
      expect(state.placeId).toBe('kokiri')
      expect(state.age).toBe('child')
      expect(state.skulltulaCount).toBe(1)
      expect(state.collectedSkulltulaIds).toEqual(['kokiri-gs-01'])
      expect(state.collectedBottleIds).toEqual([])
      expect(state.authoritativeBottles).toBe(true)
      expect(searchPatterns).toEqual([MAIN_MOD0_PATTERN_HEX])
    })
  })

  it('accepts NX2Saria heap pointers above 4 GiB only while status reports emulator: "nx2saria"', async () => {
    const mainBase = 0x7000000000n
    const regions = createLongshotMemoryRegions({
      mainBase,
      subSingletonPtr: 0x130100000n,
      pObjPtr: 0x130200000n,
      subArrPtr: 0x130300000n,
      sub7Ptr: 0x130400000n,
      sub23Ptr: 0x130500000n,
      sub36Ptr: 0x130600000n,
      gdmPtr: 0x131000000n,
      intEntriesPtr: 0x131100000n,
      intHashTablePtr: 0x131200000n,
      boolEntriesPtr: 0x131300000n,
      boolHashTablePtr: 0x131400000n,
      masterTablePtr: 0x132000000n,
      scenePath: 'Work/Banc/Scene/KokiriForest/KokiriForest.bcett.json',
      x: 0.3,
      y: 12.5,
      z: -5.5,
      skulltulaCount: 1,
      couponCount: 499,
      collectedSkulltulaIds: new Set(['kokiri-gs-01']),
      collectedHeartContainerIds: new Set(),
      collectedMasterHeartPieceIds: new Set(),
      collectedBoolHashes: new Set(),
    })

    await withMockLongshotRpcServer(
      mainBase,
      regions,
      async () => {
        const state = await getLichiiTelemetryState()
        expect(state.emulator).toBe('nx2saria')
        expect(state.source).toBe('memory')
        expect(state.scene).toBe('KokiriForest')
        expect(state.skulltulaCount).toBe(1)
        expect(state.collectedSkulltulaIds).toEqual(['kokiri-gs-01'])
      },
      'nx2saria',
    )

    await withMockLongshotRpcServer(
      mainBase,
      regions,
      async () => {
        const state = await getLichiiTelemetryState()
        expect(state.emulator).toBe('ootpc')
        expect(state.source).toBe('memory')
        expect(state.scene).toBe('KokiriForest')
        expect(state.skulltulaCount).toBe(1)
        expect(state.collectedSkulltulaIds).toEqual(['kokiri-gs-01'])
      },
      'ootpc',
    )

    // The floor follows each status response, so other emulators still reject these pointers
    await withMockLongshotRpcServer(mainBase, regions, async () => {
      const state = await getLichiiTelemetryState()
      expect(state.emulator).toBe('longshot')
      expect(state.source).not.toBe('memory')
    })
  })
})

describe('getMinGuestHeapPtr', () => {
  it('lowers the guest heap pointer floor to 4 GiB only for nx2saria and ootpc', () => {
    expect(getMinGuestHeapPtr('nx2saria')).toBe(0x100000000n)
    expect(getMinGuestHeapPtr('ootpc')).toBe(0x100000000n)
    for (const emulator of ['longshot', 'relink', 'triforce', 'cheezyemu', 'fritchii', 'lichii', 'eden']) {
      expect(getMinGuestHeapPtr(emulator)).toBe(0x1000000000n)
    }
    expect(getMinGuestHeapPtr(undefined)).toBe(0x1000000000n)
    expect(getMinGuestHeapPtr(null)).toBe(0x1000000000n)
    expect(getMinGuestHeapPtr('NX2Saria')).toBe(0x1000000000n)
    expect(getMinGuestHeapPtr('OOTPC')).toBe(0x1000000000n)
    expect(getMinGuestHeapPtr(42)).toBe(0x1000000000n)
  })
})

describe('projectToPlaceMap', () => {
  it('centers uncalibrated scenes on the actual SVG viewBox center rather than (420, 420)', () => {
    const castle = dataset.places.find((p) => p.id === 'castillo')!
    expect(castle).toBeDefined()
    // GanonsCastleExterior capture center is (camX: 0, camZ: -80)
    expect(projectToPlaceMap('GanonsCastleExterior', castle, 'adulto', 0.0, -80.0)).toEqual({
      x: 0.5,
      y: 0.5,
    })
  })

  it('projects calibrated HyruleCastle landmarks accurately', () => {
    const castle = dataset.places.find((p) => p.id === 'castillo')!
    expect(castle).toBeDefined()

    // South entrance from Market (nino map)
    expect(projectToPlaceMap('HyruleCastle', castle, 'nino', 13.49, -14.0)).toEqual({
      x: 0.4726,
      y: 0.8888,
    })
    // NW castle tower / moat (nino map)
    expect(projectToPlaceMap('HyruleCastle', castle, 'nino', -27.14, -119.52)).toEqual({
      x: 0.1193,
      y: 0.2413,
    })
  })

  it('projects calibrated Market landmarks accurately', () => {
    const market = dataset.places.find((p) => p.id === 'ciudadela')!
    expect(market).toBeDefined()

    // South entrance from Hyrule Field (adulto map)
    expect(projectToPlaceMap('Market', market, 'adulto', -1.7, 62.43)).toEqual({
      x: 0.2373,
      y: 0.8395,
    })
    // Temple of Time entrance at NE (adulto map)
    expect(projectToPlaceMap('Market', market, 'adulto', 47.21, -33.14)).toEqual({
      x: 0.699,
      y: 0.2007,
    })
    // Temple of Time entrance at NE (nino map)
    expect(projectToPlaceMap('Market', market, 'nino', 49.38, -34.0)).toEqual({
      x: 0.8174,
      y: 0.2083,
    })
    // South entrance from Hyrule Field (nino map)
    expect(projectToPlaceMap('Market', market, 'nino', -1.71, 64.96)).toEqual({
      x: 0.5046,
      y: 0.858,
    })
  })

  it('projects calibrated DodongoCavern landmarks accurately', () => {
    const dodongos = dataset.places.find((p) => p.id === 'dodongos')!
    expect(dodongos).toBeDefined()

    // South entrance on 1F
    expect(projectToPlaceMap('DodongoCavern', dodongos, '1F', 0.0, 40.16)).toEqual({
      x: 0.356,
      y: 0.8711,
    })
    // North corridor/block room
    expect(projectToPlaceMap('DodongoCavern', dodongos, '1F', -1.42, -106.48)).toEqual({
      x: 0.3489,
      y: 0.0967,
    })
  })

  it('projects calibrated GoronCity landmarks accurately', () => {
    const goronCity = dataset.places.find((p) => p.id === 'goron')!
    expect(goronCity).toBeDefined()
    const mapId = goronCity.startMap ?? 'principal'

    // South entrance from Death Mountain Trail
    expect(projectToPlaceMap('GoronCity', goronCity, mapId, 1.63, 34.39)).toEqual({
      x: 0.5565,
      y: 0.8585,
    })
    // North exit to Death Mountain Crater
    expect(projectToPlaceMap('GoronCity', goronCity, mapId, -0.15, -46.53)).toEqual({
      x: 0.5395,
      y: 0.1228,
    })
  })

  it('projects calibrated DeathMountainCrater landmarks accurately', () => {
    const crater = dataset.places.find((p) => p.id === 'crater')!
    expect(crater).toBeDefined()
    const mapId = crater.startMap ?? 'principal'

    // NW entrance from Goron City
    expect(projectToPlaceMap('DeathMountainCrater', crater, mapId, -57.37, -20.2)).toEqual({
      x: 0.1564,
      y: 0.2787,
    })
    // SE exit to Death Mountain Trail
    expect(projectToPlaceMap('DeathMountainCrater', crater, mapId, 15.56, 58.53)).toEqual({
      x: 0.7457,
      y: 0.8433,
    })
  })

  it('projects calibrated GerudoFortress landmarks accurately', () => {
    const gerudoFortress = dataset.places.find((p) => p.id === 'fortaleza')!
    expect(gerudoFortress).toBeDefined()
    const mapId = gerudoFortress.startMap ?? 'principal'

    // SW entrance from Gerudo Valley
    expect(projectToPlaceMap('GerudoFortress', gerudoFortress, mapId, -25.95, -23.92)).toEqual({
      x: 0.1654,
      y: 0.4772,
    })
    // NW gate to Haunted Wasteland
    expect(projectToPlaceMap('GerudoFortress', gerudoFortress, mapId, -30.55, -104.2)).toEqual({
      x: 0.1502,
      y: 0.1604,
    })
    // NE Horseback Archery loop
    expect(projectToPlaceMap('GerudoFortress', gerudoFortress, mapId, 179.08, -87.38)).toEqual({
      x: 0.8429,
      y: 0.2268,
    })
  })

  it('projects calibrated GerudoValley landmarks accurately', () => {
    const gerudoValley = dataset.places.find((p) => p.id === 'valle')!
    expect(gerudoValley).toBeDefined()
    const mapId = gerudoValley.startMap ?? 'principal'

    // SE entrance from Hyrule Field
    expect(projectToPlaceMap('GerudoValley', gerudoValley, mapId, 77.82, 27.37)).toEqual({
      x: 0.9214,
      y: 0.7037,
    })
    // West exit to Gerudo's Fortress
    expect(projectToPlaceMap('GerudoValley', gerudoValley, mapId, -61.54, -6.45)).toEqual({
      x: 0.1423,
      y: 0.5157,
    })
  })

  it('projects calibrated LakeHylia landmarks accurately', () => {
    const lakeHylia = dataset.places.find((p) => p.id === 'lago')!
    expect(lakeHylia).toBeDefined()
    const mapId = lakeHylia.startMap ?? 'principal'

    // NE entrance from Hyrule Field
    expect(projectToPlaceMap('LakeHylia', lakeHylia, mapId, -96.78, 404.15)).toEqual({
      x: 0.8055,
      y: 0.1305,
    })
    // SW shore
    expect(projectToPlaceMap('LakeHylia', lakeHylia, mapId, -307.44, 529.44)).toEqual({
      x: 0.1416,
      y: 0.6445,
    })
  })

  it('routes seamless HyruleField coordinates into LonLonRanch and LakeHylia sub-regions', () => {
    expect(resolveEffectiveScene('HyruleField', -62.64, 186.58)).toBe('LonLonRanch')
    expect(resolveEffectiveScene('HyruleField', -142.54, 263.59)).toBe('LonLonRanch')
    expect(resolveEffectiveScene('HyruleField', -62.07, 184.59)).toBe('HyruleField')

    expect(resolveEffectiveScene('HyruleField', -96.78, 404.15)).toBe('LakeHylia')
    expect(resolveEffectiveScene('HyruleField', -307.44, 529.44)).toBe('LakeHylia')

    expect(resolveEffectiveScene('HyruleField', -0.05, 33.03)).toBe('HyruleField')
    expect(resolveEffectiveScene('HyruleField', 197.31, 309.95)).toBe('HyruleField')
    expect(resolveEffectiveScene('ZoraRiver', -96.78, 404.15)).toBe('ZoraRiver')
  })

  it('projects calibrated ZoraFountain landmarks accurately', () => {
    const zoraFountain = dataset.places.find((p) => p.id === 'fuente')!
    expect(zoraFountain).toBeDefined()

    // West entrance from Zora's Domain (adulto map)
    expect(projectToPlaceMap('ZoraFountain', zoraFountain, 'adulto', -15.79, -24.33)).toEqual({
      x: 0.1431,
      y: 0.3813,
    })
    // Great Fairy Fountain entrance at SE (adulto map)
    expect(projectToPlaceMap('ZoraFountain', zoraFountain, 'adulto', 60.28, 46.41)).toEqual({
      x: 0.7141,
      y: 0.9408,
    })
  })

  it('projects calibrated ZoraDomain landmarks accurately', () => {
    const zoraDomain = dataset.places.find((p) => p.id === 'dominio')!
    expect(zoraDomain).toBeDefined()
    const mapId = zoraDomain.startMap ?? 'principal'

    // North entrance from Zora River
    expect(projectToPlaceMap('ZoraDomain', zoraDomain, mapId, 4.61, -36.16)).toEqual({
      x: 0.3109,
      y: 0.2199,
    })
    // Corridor leading to Zora's Fountain
    expect(projectToPlaceMap('ZoraDomain', zoraDomain, mapId, 87.98, 15.58)).toEqual({
      x: 0.8731,
      y: 0.7529,
    })
  })

  it('projects calibrated ZoraRiver landmarks accurately', () => {
    const zoraRiver = dataset.places.find((p) => p.id === 'rio')!
    expect(zoraRiver).toBeDefined()
    const mapId = zoraRiver.startMap ?? 'principal'

    // SW entrance from Hyrule Field
    expect(projectToPlaceMap('ZoraRiver', zoraRiver, mapId, -89.61, 24.63)).toEqual({
      x: 0.112,
      y: 0.7811,
    })
    // Triforce emblem platform in front of Zora's Domain waterfall
    expect(projectToPlaceMap('ZoraRiver', zoraRiver, mapId, 125.93, -40.9)).toEqual({
      x: 0.8545,
      y: 0.2947,
    })
  })

  it('projects calibrated LonLonRanch landmarks accurately', () => {
    const lonLon = dataset.places.find((p) => p.id === 'lonlon')!
    expect(lonLon).toBeDefined()
    const mapId = lonLon.startMap ?? 'principal'

    // North gate to Hyrule Field
    expect(projectToPlaceMap('LonLonRanch', lonLon, mapId, -62.64, 186.58)).toEqual({
      x: 0.6558,
      y: 0.1503,
    })
    // SW tower/silo
    expect(projectToPlaceMap('LonLonRanch', lonLon, mapId, -142.54, 263.59)).toEqual({
      x: 0.1777,
      y: 0.6769,
    })
  })

  it('projects calibrated HyruleField landmarks accurately', () => {
    const hyruleField = dataset.places.find((p) => p.id === 'llanura')!
    expect(hyruleField).toBeDefined()
    const mapId = hyruleField.startMap ?? 'principal'

    // Hyrule Castle Town bridge
    expect(projectToPlaceMap('HyruleField', hyruleField, mapId, -0.05, 33.03)).toEqual({
      x: 0.5834,
      y: 0.1488,
    })
    // Kokiri Forest entrance
    expect(projectToPlaceMap('HyruleField', hyruleField, mapId, 197.31, 309.95)).toEqual({
      x: 0.8857,
      y: 0.7059,
    })
  })

  it('preserves explicit cx/cz calibration when provided and returns null for missing mapId', () => {
    const kokiri = dataset.places.find((p) => p.id === 'kokiri')!
    expect(kokiri).toBeDefined()
    expect(projectToPlaceMap('KokiriForest', kokiri, null, 0, 0)).toBeNull()

    const projected = projectToPlaceMap('KokiriForest', kokiri, kokiri.startMap ?? 'principal', 0, 0)
    expect(projected).not.toBeNull()
    expect(projected!.x).toBeGreaterThan(0.02)
    expect(projected!.x).toBeLessThan(0.98)
    expect(projected!.y).toBeGreaterThan(0.02)
    expect(projected!.y).toBeLessThan(0.98)
  })

  it('projects calibrated InsideTheDekuTree landmarks accurately', () => {
    const deku = dataset.places.find((p) => p.id === 'deku')!
    expect(deku).toBeDefined()

    // South entrance on 1F (Point 1)
    expect(projectToPlaceMap('InsideTheDekuTree', deku, '1F', -0.17, 14.25)).toEqual({
      x: 0.4457,
      y: 0.8023,
    })
    // Northeast corner on 1F (Point 2)
    expect(projectToPlaceMap('InsideTheDekuTree', deku, '1F', 10.83, -7.94)).toEqual({
      x: 0.8516,
      y: 0.22,
    })
  })
})

describe('owned requirement detection (GDM + progress.sav)', () => {
  it('classifyGdmRequirements maps equipment, dual hashes, and planted beans', () => {
    expect(KNOWN_REQUIREMENT_BOOL_HASH_MAP).toHaveLength(34)

    const boolValues = new Map<number, boolean>([
      [0x2bb00768, true], // bombs (Item_Bomb)
      [0x1da2c511, true], // ocarina (Item_Ocarina_Time)
      [0x38aea3bb, true], // longshot
      [0x01c20002, true], // zeldas-lullaby
      [0xff98ed58, false], // hookshot false
    ])

    expect(classifyGdmRequirements(boolValues, [])).toEqual([
      'bombs',
      'longshot',
      'ocarina',
      'zeldas-lullaby',
    ])

    expect(classifyGdmRequirements(boolValues, ['lago-bean-01'])).toEqual([
      'bombs',
      'longshot',
      'ocarina',
      'planted-bean',
      'zeldas-lullaby',
    ])
  })

  it('parseSaveSlot reads owned requirement flags from progress.sav Sec 1 optionally', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oot-req-sav-'))
    try {
      const slotDir = path.join(tmpRoot, 'slot_00')
      fs.mkdirSync(slotDir, { recursive: true })

      // Build minimal progress.sav with Sec 1 requirement flags + 1 planted bean
      const entries: Array<{ h: number; v: number }> = [
        { h: 0x0ec22ee1, v: 1 }, // slingshot
        { h: 0x7f4ce38d, v: 1 }, // boomerang
        { h: 0x42bd296f, v: 1 }, // ocarina (Fairy)
        { h: 0x64dc5440, v: 1 }, // epona
        { h: 0xff98ed58, v: 0 }, // hookshot (false)
        { h: 0x2a1c58ce, v: 1 }, // coloso-bean-01 -> also triggers planted-bean
      ]
      const dataOff = 0x28 + entries.length * 8
      const prog = Buffer.alloc(dataOff)
      prog.writeUInt32LE(dataOff, 8)
      entries.forEach((e, idx) => {
        const off = 0x28 + idx * 8
        prog.writeUInt32LE(e.h >>> 0, off)
        prog.writeUInt32LE(e.v >>> 0, off + 4)
      })
      fs.writeFileSync(path.join(slotDir, 'progress.sav'), prog)

      const parsed = parseSaveSlot({ dir: slotDir, key: `req-${Date.now()}`, mtimeMs: Date.now() })
      expect(parsed).not.toBeNull()
      expect(parsed!.savedBeanIds).toEqual(['coloso-bean-01'])
      expect(parsed!.savedRequirementKeys).toEqual([
        'boomerang',
        'epona',
        'ocarina',
        'planted-bean',
        'slingshot',
      ])
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  it('scanGdmContainerHashTableBuffer + classifyGdmCollectibles remain compatible when optional requirement hashes are mixed in', () => {
    const reqHashes = [0x2bb00768, 0x38aea3bb, 0x01c20002] // bombs, longshot, zeldas-lullaby
    const collectibleHashes = [
      ...KNOWN_HEART_PIECE_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_BEAN_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_FAIRY_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_BOTTLE_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
      ...KNOWN_THOUGHT_BOOL_HASH_MAP.map((e) => e.hash >>> 0),
    ]
    const boolValues = new Map<number, boolean>()
    for (const h of collectibleHashes) boolValues.set(h, false)
    for (const h of reqHashes) boolValues.set(h, true)
    boolValues.set(0x7a7961c3, true) // kakariko-bottle-01

    expect(classifyGdmCollectibles(boolValues, 0)).toEqual({
      heartPieceIds: [],
      beanIds: [],
      fairyIds: [],
      bottleIds: ['kakariko-bottle-01'],
      thoughtIds: [],
    })
    expect(classifyGdmRequirements(boolValues, [])).toEqual([
      'bombs',
      'longshot',
      'zeldas-lullaby',
    ])

    // Removing a required collectible hash still causes classifyGdmCollectibles to return null
    // even though total map size exceeds 64 due to optional requirement hashes.
    boolValues.delete(0x7a7961c3)
    expect(classifyGdmCollectibles(boolValues, 0)).toBeNull()
  })
})
