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
  it('resolves LICHII_HOST with whitespace trimming and 127.0.0.1 fallback', () => {
    expect(getLichiiHost({})).toBe('127.0.0.1')
    expect(getLichiiHost({ LICHII_HOST: '   ' })).toBe('127.0.0.1')
    expect(getLichiiHost({ LICHII_HOST: ' 192.168.1.42 ' })).toBe('192.168.1.42')
  })

  it('validates LICHII_PORT within 1..65535 and falls back to 6545', () => {
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
    expect(getLichiiPort({ LICHII_PORT: 'invalid' })).toBe(6545)
  })

  it('checks LICHII_SAVE_DIR before default APPDATA save directory', () => {
    const appData = path.join(os.tmpdir(), 'fake-appdata')
    const explicit = path.join(os.tmpdir(), 'custom-lichii-saves')
    const defaultExpected = path.join(appData, 'lichii', 'nand', 'user', 'save', '0000000000000000')

    expect(getCandidateSaveDirs({ APPDATA: appData })).toEqual([defaultExpected])
    expect(getCandidateSaveDirs({ APPDATA: appData, LICHII_SAVE_DIR: '   ' })).toEqual([
      defaultExpected,
    ])
    expect(getCandidateSaveDirs({ APPDATA: appData, LICHII_SAVE_DIR: explicit })).toEqual([
      path.resolve(explicit),
      defaultExpected,
    ])
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
