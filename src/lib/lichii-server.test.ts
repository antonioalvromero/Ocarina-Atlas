import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { dataset, formatFloorLabel } from './data'
import {
  deriveConnectionStatus,
  deriveDynamicVtables,
  deriveLastPickedItem,
  detectEmulatorFromPath,
  determineDungeonFloor,
  findLatestSaveSlotDir,
  getCandidateSaveDirs,
  getLichiiHost,
  getLichiiPort,
  isValidSub36Buffer,
  KNOWN_HEART_CONTAINER_HASH_MAP,
  KNOWN_SKULLTULA_HASH_MAP,
  LichiiRpcClient,
  parseGdmSkulltulaCount,
  parseGdmStockNumBuffer,
  parseLichiiPort,
  parseMasterFlagTableBuffer,
  projectToPlaceMap,
  resolveEffectiveScene,
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

  it('checks LICHII_SAVE_DIR / FRITCHII_SAVE_DIR before default APPDATA save directories', () => {
    const appData = path.join(os.tmpdir(), 'fake-appdata')
    const explicit = path.join(os.tmpdir(), 'custom-lichii-saves')
    const explicitFritchii = path.join(os.tmpdir(), 'custom-fritchii-saves')
    const fritchiiDefault = path.join(appData, 'fritchii', 'nand', 'user', 'save', '0000000000000000')
    const lichiiDefault = path.join(appData, 'lichii', 'nand', 'user', 'save', '0000000000000000')
    const edenDefault = path.join(appData, 'eden', 'nand', 'user', 'save', '0000000000000000')

    expect(getCandidateSaveDirs({ APPDATA: appData })).toEqual([
      fritchiiDefault,
      lichiiDefault,
      edenDefault,
    ])
    expect(getCandidateSaveDirs({ APPDATA: appData, LICHII_SAVE_DIR: '   ' })).toEqual([
      fritchiiDefault,
      lichiiDefault,
      edenDefault,
    ])
    expect(
      getCandidateSaveDirs({
        APPDATA: appData,
        LICHII_SAVE_DIR: explicit,
        FRITCHII_SAVE_DIR: explicitFritchii,
      }),
    ).toEqual([
      path.resolve(explicit),
      path.resolve(explicitFritchii),
      fritchiiDefault,
      lichiiDefault,
      edenDefault,
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
  })

  it('detects collected Heart Containers when 0x100000000n is set and omits when unset', () => {
    const hcEntry = KNOWN_HEART_CONTAINER_HASH_MAP.find((e) =>
      e.itemIds.includes('espiritu-heart-01'),
    )
    expect(hcEntry).toBeDefined()
    expect(hcEntry?.hashes).toContain(0x41811f125b1eedd5n)

    const collectedBuf = buildSortedTable(
      new Set(['espiritu-gs-01']),
      new Map([[0x41811f125b1eedd5n, 0x0002000100000018n]]),
    )
    const parsedCollected = parseMasterFlagTableBuffer(collectedBuf)
    expect(parsedCollected).not.toBeNull()
    expect(parsedCollected?.collectedItemIds).toEqual(['espiritu-gs-01'])
    expect(parsedCollected?.collectedHeartContainerIds).toEqual(['espiritu-heart-01'])

    const uncollectedBuf = buildSortedTable(
      new Set(['espiritu-gs-01']),
      new Map([[0x41811f125b1eedd5n, 0x0000000000000018n]]),
    )
    const parsedUncollected = parseMasterFlagTableBuffer(uncollectedBuf)
    expect(parsedUncollected).not.toBeNull()
    expect(parsedUncollected?.collectedItemIds).toEqual(['espiritu-gs-01'])
    expect(parsedUncollected?.collectedHeartContainerIds).toEqual([])
  })

  it('returns null on bad header or incomplete table', () => {
    expect(parseMasterFlagTableBuffer(Buffer.alloc(64))).toBeNull()
    const partial = Buffer.alloc(32)
    partial.writeBigUInt64LE(0x00006e56f79838e8n, 0)
    partial.writeBigUInt64LE(0x00006e56f79838ean, 16)
    expect(parseMasterFlagTableBuffer(partial)).toBeNull()
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
})
