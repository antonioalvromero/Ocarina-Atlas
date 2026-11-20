import {
  ALL_SAVEBUF_SEC1_BOOL_HASHES,
  buildGdmBoolWindows,
  classifyGdmCollectibles,
  classifyGdmRequirements,
  EXPECTED_SAVEBUF_COLLECTIBLE_HASH_COUNT,
  GDM_BOOL_CONTAINER_OFFSET,
  GDM_BOOL_ENTRY_STRIDE,
  GDM_INT_CONTAINER_OFFSET,
  GDM_INT_ENTRY_STRIDE,
  GDM_STOCK_TOKEN_HASH,
  type GdmBoolWindowDescriptor,
  GHOST_SHOP_COUPON_NUM_HASH,
  isValidMasterTableHeader,
  KNOWN_REQUIREMENT_BOOL_HASHES,
  MASTER_FLAG_ENTRY_0_HEX,
  MASTER_FLAG_READ_BYTES,
  MASTER_FLAG_READ_CHUNK,
  parseGdmBoolEntryBuffer,
  parseGdmIntEntryBuffer,
  parseGdmSkulltulaCount,
  parseGdmStockNumBuffer,
  parseMasterFlagTableChunks,
  parseSaveBufCollectibleRange,
  parseSaveBufRequirementRange,
  type SaveBufCollectibles,
  scanGdmContainerHashTableBuffer,
} from './collectible-hashes'
import { normalizeSceneName } from './coordinate-projection'
import {
  bigintToHex,
  deriveDynamicVtables,
  type DynamicVtables,
  ensureMainBase,
  isValidSub36Buffer,
  lichiiRpc,
  MAIN_GDM_BSS_OFFSET,
  MAIN_SUB6_BSS_OFFSET,
  MAIN_SUB24_BSS_OFFSET,
  MIN_GUEST_HEAP_PTR,
  parseGdmContainerHeader,
  readMemoryBuffer,
  readU64At,
  resetMainBaseCache,
  searchHeapWithFallback,
  u64ToLeHex,
  validateMainBaseHeader,
  WORK_BANC_SCENE_PATTERN_HEX,
} from './rpc-client'
import { readNullTerminatedAscii } from './save-parser'

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export type LiveMemoryTelemetry = {
  position: { x: number; y: number; z: number; yaw: number } | null
  scene: string | null
  ageHint: 'child' | 'adult' | null
  masterCollectedIds: string[] | null
  masterHeartContainerIds: string[] | null
  masterHeartPieceIds: string[] | null
  saveBufCollectibles: SaveBufCollectibles | null
  ownedRequirements: string[] | null
  liveSavedHashes: Set<bigint>
  liveSkulltulaCount: number | null
  readFailed: boolean
}

export function emptyLiveMemoryTelemetry(readFailed = false): LiveMemoryTelemetry {
  return {
    position: null,
    scene: null,
    ageHint: null,
    masterCollectedIds: null,
    masterHeartContainerIds: null,
    masterHeartPieceIds: null,
    saveBufCollectibles: null,
    ownedRequirements: null,
    liveSavedHashes: new Set<bigint>(),
    liveSkulltulaCount: null,
    readFailed,
  }
}

// Cached memory addresses for low-latency polling (reset to 0/0x0 on session reset)
let cachedSub36Addr = '0x0'
let cachedParentObjAddr = 0n
let cachedSub7Addr = 0n
let cachedSub23Addr = 0n

let cachedGdmAddr = 0n
let cachedLiveStockAddr = '0x0'
let cachedLiveCountAddr = '0x0'
let cachedLiveGdmCountAddr = '0x0'
let cachedLiveHashesAddr = '0x0'
let cachedMasterFlagTableAddr = '0x0'
let cachedMasterFlagTableCount = 0

let cachedSaveBufPtr = 0n
let cachedSaveBufCollectibleOffsets: Map<number, number> | null = null
let cachedSaveBufCollectibleMinOff = 0
let cachedSaveBufCollectibleMaxEnd = 0

let cachedGdmBoolEntryAddrs: Map<number, bigint> | null = null
let cachedGdmBoolWindows: GdmBoolWindowDescriptor[] | null = null
let cachedGdmCouponAddr = 0n

let cachedLiveScene: string | null = null
let cachedLiveAgeHint: 'child' | 'adult' | null = null
let cachedLiveSavedHashes = new Set<bigint>()
let cachedMasterCollectedIds: string[] | null = null
let cachedMasterHeartContainerIds: string[] | null = null
let cachedMasterHeartPieceIds: string[] | null = null
let cachedSaveBufCollectibles: SaveBufCollectibles | null = null
let cachedOwnedRequirements: string[] | null = null
let lastHashesReadTime = 0
let lastMasterReadTime = 0
let lastSaveBufCollectibleReadTime = 0
let lastMasterRescanTime = 0
let lastGdmRescanTime = 0
let prevMasterReadCount: number | null = null
let lastAgeReadTime = 0
let lastRescanTime = 0

const sessionCacheResetListeners = new Set<() => void>()

export function registerSessionCacheResetListener(fn: () => void): void {
  sessionCacheResetListeners.add(fn)
}

export function clearPlayerAndGdmSessionCaches(): void {
  cachedSub36Addr = '0x0'
  cachedParentObjAddr = 0n
  cachedSub7Addr = 0n
  cachedSub23Addr = 0n
  cachedGdmAddr = 0n
  cachedLiveStockAddr = '0x0'
  cachedLiveCountAddr = '0x0'
  cachedLiveGdmCountAddr = '0x0'
  cachedLiveHashesAddr = '0x0'
  cachedMasterFlagTableAddr = '0x0'
  cachedMasterFlagTableCount = 0
  cachedSaveBufPtr = 0n
  cachedSaveBufCollectibleOffsets = null
  cachedSaveBufCollectibleMinOff = 0
  cachedSaveBufCollectibleMaxEnd = 0
  cachedGdmBoolEntryAddrs = null
  cachedGdmBoolWindows = null
  cachedGdmCouponAddr = 0n
  cachedLiveScene = null
  cachedLiveAgeHint = null
  lastRescanTime = 0
  lastMasterReadTime = 0
  lastSaveBufCollectibleReadTime = 0
  lastMasterRescanTime = 0
  lastGdmRescanTime = 0
  lastHashesReadTime = 0
  lastAgeReadTime = 0
  cachedMasterCollectedIds = null
  cachedMasterHeartContainerIds = null
  cachedMasterHeartPieceIds = null
  cachedSaveBufCollectibles = null
  cachedOwnedRequirements = null
  prevMasterReadCount = null
  cachedLiveSavedHashes = new Set<bigint>()
  for (const listener of sessionCacheResetListeners) {
    listener()
  }
}

export function resetLiveSessionCaches(): void {
  resetMainBaseCache()
  clearPlayerAndGdmSessionCaches()
}

async function resolveGameDataMgr(mainBase: bigint, vtables: DynamicVtables): Promise<bigint> {
  if (cachedGdmAddr !== 0n) return cachedGdmAddr
  if (mainBase === 0n || !lichiiRpc.isConnected()) return 0n
  const gdmPtr = await readU64At(bigintToHex(mainBase + MAIN_GDM_BSS_OFFSET), 400)
  if (gdmPtr <= MIN_GUEST_HEAP_PTR) return 0n
  const vt = await readU64At(bigintToHex(gdmPtr), 400)
  if (vt !== vtables.gdmVt) return 0n
  cachedGdmAddr = gdmPtr
  return gdmPtr
}

async function resolveMasterTableMetaFromGdm(
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<boolean> {
  const gdm = await resolveGameDataMgr(mainBase, vtables)
  if (gdm === 0n) return false
  const tblMeta = await readMemoryBuffer(bigintToHex(gdm + 0xdc0n), 16, 400)
  if (!tblMeta || tblMeta.length < 16) return false
  const count = Number(tblMeta.readBigUInt64LE(0))
  const ptr = tblMeta.readBigUInt64LE(8)
  if (ptr <= MIN_GUEST_HEAP_PTR || count < 100 || count > 65536) return false
  cachedMasterFlagTableAddr = bigintToHex(ptr)
  cachedMasterFlagTableCount = count
  return true
}

async function readMasterFlagTableFirstChunk(
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<{ firstChunk: Buffer; totalTargetBytes: number } | null> {
  if (cachedMasterFlagTableAddr === '0x0') {
    await resolveMasterTableMetaFromGdm(mainBase, vtables)
  }

  let totalTargetBytes =
    cachedMasterFlagTableCount > 0
      ? clamp(cachedMasterFlagTableCount * 16, 32, MASTER_FLAG_READ_CHUNK * 12)
      : MASTER_FLAG_READ_BYTES
  let firstChunk = await readMemoryBuffer(
    cachedMasterFlagTableAddr,
    Math.min(MASTER_FLAG_READ_CHUNK, totalTargetBytes),
    600,
  )
  if (isValidMasterTableHeader(firstChunk)) {
    return { firstChunk, totalTargetBytes }
  }

  // Re-try via .bss GameDataMgr pointer in case masterTable moved before resorting to heap scan
  cachedMasterFlagTableAddr = '0x0'
  cachedMasterFlagTableCount = 0
  if (await resolveMasterTableMetaFromGdm(mainBase, vtables)) {
    totalTargetBytes = clamp(cachedMasterFlagTableCount * 16, 32, MASTER_FLAG_READ_CHUNK * 12)
    firstChunk = await readMemoryBuffer(
      cachedMasterFlagTableAddr,
      Math.min(MASTER_FLAG_READ_CHUNK, totalTargetBytes),
      600,
    )
    if (isValidMasterTableHeader(firstChunk)) {
      return { firstChunk, totalTargetBytes }
    }
  }

  const now = Date.now()
  if (!lichiiRpc.isConnected() || now - lastMasterRescanTime <= 2500) return null
  lastMasterRescanTime = now

  const hits = await searchHeapWithFallback({
    pattern: MASTER_FLAG_ENTRY_0_HEX,
    start: '0x2160000000',
    end: '0x21c0000000',
    maxHits: 8,
    fastBudgetMs: 800,
    heapBudgetMs: 1500,
  })

  for (const hit of hits) {
    const candidate = await readMemoryBuffer(hit, MASTER_FLAG_READ_CHUNK, 600)
    if (isValidMasterTableHeader(candidate)) {
      cachedMasterFlagTableAddr = hit
      cachedMasterFlagTableCount = 0
      return { firstChunk: candidate, totalTargetBytes: MASTER_FLAG_READ_BYTES }
    }
  }
  return null
}

async function readMasterFlagCollectedIds(
  now: number,
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<string[] | null> {
  const head = await readMasterFlagTableFirstChunk(mainBase, vtables)
  if (!head) {
    cachedMasterCollectedIds = null
    cachedMasterHeartContainerIds = null
    cachedMasterHeartPieceIds = null
    return null
  }

  const baseAddr = BigInt(cachedMasterFlagTableAddr)
  const chunks: Buffer[] = [head.firstChunk]
  for (let off = head.firstChunk.length; off < head.totalTargetBytes; off += MASTER_FLAG_READ_CHUNK) {
    const prev = chunks[chunks.length - 1]!
    if (prev.length >= 32) {
      const hPrev = prev.readBigUInt64LE(prev.length - 32)
      const hLast = prev.readBigUInt64LE(prev.length - 16)
      if (hLast === 0n || hLast <= hPrev) break
    }
    const readSize = Math.min(MASTER_FLAG_READ_CHUNK, head.totalTargetBytes - off)
    if (readSize < 16) break
    const chunk = await readMemoryBuffer(bigintToHex(baseAddr + BigInt(off)), readSize, 600)
    if (!chunk || chunk.length === 0) break
    chunks.push(chunk)
  }

  const parsed = parseMasterFlagTableChunks(chunks)
  if (!parsed) {
    cachedMasterCollectedIds = null
    cachedMasterHeartContainerIds = null
    cachedMasterHeartPieceIds = null
    return null
  }
  cachedMasterCollectedIds = parsed.collectedItemIds
  cachedMasterHeartContainerIds = parsed.collectedHeartContainerIds
  cachedMasterHeartPieceIds = parsed.collectedHeartPieceIds
  lastMasterReadTime = now
  return parsed.collectedItemIds
}

async function resolveSubPointersFromPObj(
  pObjPtr: bigint,
  vtables: DynamicVtables,
  validatePObjVt: boolean,
): Promise<{ sub36Ptr: bigint; sub7Ptr: bigint; sub23Ptr: bigint } | null> {
  if (pObjPtr <= MIN_GUEST_HEAP_PTR) return null
  const pObjBuf = await readMemoryBuffer(bigintToHex(pObjPtr), 0x60, 500)
  if (!pObjBuf || pObjBuf.length < 0x60) return null
  if (validatePObjVt && pObjBuf.readBigUInt64LE(0) !== vtables.pObjVt) return null

  const subCount = pObjBuf.readUInt32LE(0x50)
  const subArrPtr = pObjBuf.readBigUInt64LE(0x58)
  if (subCount <= 36 || subCount > 128 || subArrPtr <= MIN_GUEST_HEAP_PTR) return null

  const arrBuf = await readMemoryBuffer(bigintToHex(subArrPtr), subCount * 8, 500)
  if (!arrBuf || arrBuf.length < 37 * 8) return null

  return {
    sub36Ptr: arrBuf.readBigUInt64LE(36 * 8),
    sub7Ptr: arrBuf.readBigUInt64LE(7 * 8),
    sub23Ptr: arrBuf.readBigUInt64LE(23 * 8),
  }
}

async function resolvePlayerFromBss(
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<Buffer | null> {
  for (const bssOff of [MAIN_SUB6_BSS_OFFSET, MAIN_SUB24_BSS_OFFSET]) {
    if (!lichiiRpc.isConnected()) return null
    const subSingletonPtr = await readU64At(bigintToHex(mainBase + bssOff), 400)
    if (subSingletonPtr <= MIN_GUEST_HEAP_PTR) continue

    const singletonBuf = await readMemoryBuffer(bigintToHex(subSingletonPtr), 0x18, 400)
    if (!singletonBuf || singletonBuf.length < 0x18) continue
    const pObjPtr = singletonBuf.readBigUInt64LE(0x10)
    const subs = await resolveSubPointersFromPObj(pObjPtr, vtables, true)
    if (!subs || subs.sub36Ptr <= MIN_GUEST_HEAP_PTR) continue

    const subBuf = await readMemoryBuffer(bigintToHex(subs.sub36Ptr), 0x40, 500)
    if (!isValidSub36Buffer(subBuf, vtables.sub36Vt1, vtables.sub36Vt2)) continue

    cachedSub36Addr = bigintToHex(subs.sub36Ptr)
    cachedParentObjAddr = pObjPtr
    cachedSub7Addr = subs.sub7Ptr > MIN_GUEST_HEAP_PTR ? subs.sub7Ptr : 0n
    cachedSub23Addr = subs.sub23Ptr > MIN_GUEST_HEAP_PTR ? subs.sub23Ptr : 0n
    return subBuf
  }
  return null
}

async function resolvePlayerViaHeapFallbacks(vtables: DynamicVtables): Promise<Buffer | null> {
  const sub36Pattern = u64ToLeHex(vtables.sub36Vt1) + u64ToLeHex(vtables.sub36Vt2)
  const vtHits = await searchHeapWithFallback({
    pattern: sub36Pattern,
    start: '0x2140000000',
    end: '0x21c0000000',
    maxHits: 8,
    fastBudgetMs: 600,
    heapBudgetMs: 1500,
  })
  for (const hit of vtHits) {
    const candidate = await readMemoryBuffer(hit, 0x40, 500)
    if (isValidSub36Buffer(candidate, vtables.sub36Vt1, vtables.sub36Vt2)) {
      cachedSub36Addr = hit
      cachedParentObjAddr = 0n
      cachedSub7Addr = 0n
      cachedSub23Addr = 0n
      return candidate
    }
  }

  // Zero-vtable fallback: locate Sub[7] via "Work/Banc/Scene/" string anchor and walk back to pObj
  const sceneHits = await searchHeapWithFallback({
    pattern: WORK_BANC_SCENE_PATTERN_HEX,
    start: '0x2140000000',
    end: '0x21c0000000',
    maxHits: 32,
    fastBudgetMs: 800,
    heapBudgetMs: 1500,
  })
  for (const hit of sceneHits) {
    let hitAddr: bigint
    try {
      hitAddr = BigInt(hit)
    } catch {
      continue
    }
    const sub7Candidate = hitAddr - 0x34n
    if (sub7Candidate <= MIN_GUEST_HEAP_PTR) continue
    const sub7Hdr = await readMemoryBuffer(bigintToHex(sub7Candidate), 0x34, 400)
    if (!sub7Hdr || sub7Hdr.length < 0x34) continue
    if (sub7Hdr.readBigUInt64LE(0x28) !== hitAddr) continue
    const pObjCandidate = sub7Hdr.readBigUInt64LE(0x10)
    const subs = await resolveSubPointersFromPObj(pObjCandidate, vtables, false)
    if (!subs || subs.sub36Ptr <= MIN_GUEST_HEAP_PTR) continue

    const candidate = await readMemoryBuffer(bigintToHex(subs.sub36Ptr), 0x40, 500)
    if (isValidSub36Buffer(candidate, vtables.sub36Vt1, vtables.sub36Vt2)) {
      cachedSub36Addr = bigintToHex(subs.sub36Ptr)
      cachedParentObjAddr = pObjCandidate
      cachedSub7Addr = sub7Candidate
      cachedSub23Addr = subs.sub23Ptr > MIN_GUEST_HEAP_PTR ? subs.sub23Ptr : 0n
      return candidate
    }
  }

  return null
}

async function resolveGdmStockAddrFromContainer(
  gdm: bigint,
  vtables: DynamicVtables,
): Promise<number | null> {
  if (gdm === 0n || !lichiiRpc.isConnected()) return null
  const hdr = await readMemoryBuffer(bigintToHex(gdm + GDM_INT_CONTAINER_OFFSET), 0x28, 400)
  const parsedHdr = parseGdmContainerHeader(hdr, 9999, 32768)
  if (!parsedHdr) return null

  const hashBuf = await readMemoryBuffer(bigintToHex(parsedHdr.hashTablePtr), parsedHdr.cap * 8, 800)
  if (!hashBuf || hashBuf.length < 8) return null
  const hits = scanGdmContainerHashTableBuffer(
    hashBuf,
    parsedHdr.cnt,
    new Set([GDM_STOCK_TOKEN_HASH]),
    parsedHdr.entriesPtr,
    GDM_INT_ENTRY_STRIDE,
  )
  const entryAddrBig = hits.get(GDM_STOCK_TOKEN_HASH)
  if (!entryAddrBig) return null
  const entryAddr = bigintToHex(entryAddrBig)
  const entryBuf = await readMemoryBuffer(entryAddr, 0x28, 400)
  const val = parseGdmStockNumBuffer(entryBuf, vtables.gdmStockVt)
  if (val !== null) {
    cachedLiveStockAddr = entryAddr
    return val
  }
  return null
}

async function resolveGdmContainerEntryAddrs(
  containerAddr: bigint,
  targetHashes: ReadonlySet<number>,
  stride: bigint,
  maxCnt = 65536,
  maxCap = 131072,
  optionalTargetHashes?: ReadonlySet<number>,
): Promise<Map<number, bigint> | null> {
  if (containerAddr === 0n || !lichiiRpc.isConnected()) return null
  const hdrBuf = await readMemoryBuffer(bigintToHex(containerAddr), 0x28, 400)
  const hdr = parseGdmContainerHeader(hdrBuf, maxCnt, maxCap)
  if (!hdr) return null

  const combinedTargets =
    optionalTargetHashes && optionalTargetHashes.size > 0
      ? new Set<number>([...targetHashes, ...optionalTargetHashes])
      : targetHashes

  const totalBytes = hdr.cap * 8
  const found = new Map<number, bigint>()
  for (let off = 0; off < totalBytes && found.size < combinedTargets.size; off += MASTER_FLAG_READ_CHUNK) {
    const readSize = Math.min(MASTER_FLAG_READ_CHUNK, totalBytes - off)
    const chunk = await readMemoryBuffer(
      bigintToHex(hdr.hashTablePtr + BigInt(off)),
      readSize,
      800,
    )
    if (!chunk || chunk.length < 8) return null
    scanGdmContainerHashTableBuffer(chunk, hdr.cnt, combinedTargets, hdr.entriesPtr, stride, found)
  }

  for (const requiredHash of targetHashes) {
    if (!found.has(requiredHash)) return null
  }
  return found
}

async function resolveGdmLiveCollectibleAddrs(
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<boolean> {
  const gdm = await resolveGameDataMgr(mainBase, vtables)
  if (gdm === 0n || !lichiiRpc.isConnected()) return false

  const boolAddrs = await resolveGdmContainerEntryAddrs(
    gdm + GDM_BOOL_CONTAINER_OFFSET,
    ALL_SAVEBUF_SEC1_BOOL_HASHES,
    GDM_BOOL_ENTRY_STRIDE,
    65536,
    131072,
    KNOWN_REQUIREMENT_BOOL_HASHES,
  )
  if (!boolAddrs) return false

  const intAddrs = await resolveGdmContainerEntryAddrs(
    gdm + GDM_INT_CONTAINER_OFFSET,
    new Set([GHOST_SHOP_COUPON_NUM_HASH]),
    GDM_INT_ENTRY_STRIDE,
    16384,
    32768,
  )
  const couponAddr = intAddrs?.get(GHOST_SHOP_COUPON_NUM_HASH)
  if (!couponAddr) return false

  cachedGdmBoolEntryAddrs = boolAddrs
  cachedGdmBoolWindows = buildGdmBoolWindows(boolAddrs)
  cachedGdmCouponAddr = couponAddr
  return true
}

async function readGdmCollectiblesFromCache(
  vtables: DynamicVtables,
): Promise<SaveBufCollectibles | null> {
  if (!cachedGdmBoolWindows || cachedGdmCouponAddr === 0n) return null

  const boolValues = new Map<number, boolean>()

  for (const win of cachedGdmBoolWindows) {
    const windowBuf = await readMemoryBuffer(win.startHex, win.size, 600)
    if (!windowBuf || windowBuf.length < win.size) return null

    for (const entry of win.entries) {
      const val = parseGdmBoolEntryBuffer(windowBuf, vtables.gdmBoolVt, entry.offset)
      if (val === null) return null
      boolValues.set(entry.hash, val)
    }
  }

  const couponBuf = await readMemoryBuffer(bigintToHex(cachedGdmCouponAddr), 0x28, 400)
  const couponCount = parseGdmIntEntryBuffer(couponBuf, vtables.gdmStockVt)
  if (couponCount === null) return null

  const collectibles = classifyGdmCollectibles(boolValues, couponCount)
  if (!collectibles) return null
  cachedOwnedRequirements = classifyGdmRequirements(boolValues, collectibles.beanIds)
  return collectibles
}

async function readLiveGdmCollectibles(
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<SaveBufCollectibles | null> {
  if (!cachedGdmBoolWindows || cachedGdmCouponAddr === 0n) {
    const resolved = await resolveGdmLiveCollectibleAddrs(mainBase, vtables)
    if (!resolved) return null
  }

  let parsed = await readGdmCollectiblesFromCache(vtables)
  if (parsed === null && lichiiRpc.isConnected()) {
    cachedGdmBoolEntryAddrs = null
    cachedGdmBoolWindows = null
    cachedGdmCouponAddr = 0n
    cachedGdmAddr = 0n
    if (await resolveGdmLiveCollectibleAddrs(mainBase, vtables)) {
      parsed = await readGdmCollectiblesFromCache(vtables)
    }
  }
  return parsed
}

async function resolveSaveBufFallbackAddresses(gdm: bigint): Promise<void> {
  if (gdm === 0n || !lichiiRpc.isConnected()) return
  const saveBufPtr = await readU64At(bigintToHex(gdm + 0x1160n), 400)
  if (saveBufPtr <= MIN_GUEST_HEAP_PTR) return
  const hdr = await readMemoryBuffer(bigintToHex(saveBufPtr), 0x28, 400)
  if (!hdr || hdr.length < 0x28) return
  const dataOff = hdr.readUInt32LE(8)
  if (dataOff <= 0x28 || dataOff > 0x40000) return

  for (let off = 0x28; off < dataOff; off += MASTER_FLAG_READ_CHUNK) {
    const size = Math.min(MASTER_FLAG_READ_CHUNK, dataOff - off)
    const chunk = await readMemoryBuffer(bigintToHex(saveBufPtr + BigInt(off)), size, 500)
    if (!chunk || chunk.length < 8) break
    for (let pos = 0; pos + 8 <= chunk.length; pos += 8) {
      const h = chunk.readUInt32LE(pos)
      if (h === GDM_STOCK_TOKEN_HASH && cachedLiveCountAddr === '0x0') {
        cachedLiveCountAddr = bigintToHex(saveBufPtr + BigInt(off + pos))
      } else if (h === 0xa3db7114 && cachedLiveHashesAddr === '0x0') {
        const ptrOff = chunk.readUInt32LE(pos + 4)
        if (ptrOff >= dataOff && ptrOff < 0x80000) {
          cachedLiveHashesAddr = bigintToHex(saveBufPtr + BigInt(ptrOff))
        }
      }
      if (cachedLiveCountAddr !== '0x0' && cachedLiveHashesAddr !== '0x0') return
    }
  }
}

async function resolveSaveBufCollectibleOffsets(
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<boolean> {
  const gdm = await resolveGameDataMgr(mainBase, vtables)
  if (gdm === 0n || !lichiiRpc.isConnected()) return false
  const saveBufPtr = await readU64At(bigintToHex(gdm + 0x1160n), 400)
  if (saveBufPtr <= MIN_GUEST_HEAP_PTR) return false
  const hdr = await readMemoryBuffer(bigintToHex(saveBufPtr), 0x28, 400)
  if (!hdr || hdr.length < 0x28) return false
  const dataOff = hdr.readUInt32LE(8)
  if (dataOff <= 0x28 || dataOff > 0x40000) return false

  const offsets = new Map<number, number>()
  let requiredFoundCount = 0
  let minOff = Number.MAX_SAFE_INTEGER
  let maxEnd = 0
  let sec = 1

  for (let off = 0x28; off < dataOff && sec <= 3; off += MASTER_FLAG_READ_CHUNK) {
    const size = Math.min(MASTER_FLAG_READ_CHUNK, dataOff - off)
    const chunk = await readMemoryBuffer(bigintToHex(saveBufPtr + BigInt(off)), size, 500)
    if (!chunk || chunk.length < 8) break
    for (let pos = 0; pos + 8 <= chunk.length; pos += 8) {
      const h = chunk.readUInt32LE(pos)
      const v = chunk.readUInt32LE(pos + 4)
      if (h === 0) {
        sec = v + 1
        if (sec > 3) break
        continue
      }
      const isRequiredTarget =
        (sec === 1 && ALL_SAVEBUF_SEC1_BOOL_HASHES.has(h)) ||
        (sec === 3 && h === GHOST_SHOP_COUPON_NUM_HASH)
      const isOptionalRequirement = sec === 1 && KNOWN_REQUIREMENT_BOOL_HASHES.has(h)
      if (isRequiredTarget || isOptionalRequirement) {
        const dirOff = off + pos
        if (!offsets.has(h) && isRequiredTarget) {
          requiredFoundCount++
        }
        offsets.set(h, dirOff)
        if (dirOff < minOff) minOff = dirOff
        if (dirOff + 8 > maxEnd) maxEnd = dirOff + 8
      }
    }
  }

  if (requiredFoundCount < EXPECTED_SAVEBUF_COLLECTIBLE_HASH_COUNT || maxEnd <= minOff) {
    return false
  }
  cachedSaveBufPtr = saveBufPtr
  cachedSaveBufCollectibleOffsets = offsets
  cachedSaveBufCollectibleMinOff = minOff
  cachedSaveBufCollectibleMaxEnd = maxEnd
  return true
}

async function readSaveBufCollectibleRangeFromCache(): Promise<SaveBufCollectibles | null> {
  if (cachedSaveBufPtr === 0n || !cachedSaveBufCollectibleOffsets) return null
  const totalBytes = cachedSaveBufCollectibleMaxEnd - cachedSaveBufCollectibleMinOff
  if (totalBytes <= 0 || totalBytes > 0x40000) return null

  const chunks: Buffer[] = []
  for (let rel = 0; rel < totalBytes; rel += MASTER_FLAG_READ_CHUNK) {
    const readSize = Math.min(MASTER_FLAG_READ_CHUNK, totalBytes - rel)
    const chunk = await readMemoryBuffer(
      bigintToHex(cachedSaveBufPtr + BigInt(cachedSaveBufCollectibleMinOff + rel)),
      readSize,
      600,
    )
    if (!chunk || chunk.length < readSize) return null
    chunks.push(chunk)
  }

  const rangeBuf = Buffer.concat(chunks)
  const collectibles = parseSaveBufCollectibleRange(
    rangeBuf,
    cachedSaveBufCollectibleMinOff,
    cachedSaveBufCollectibleOffsets,
  )
  if (!collectibles) return null
  cachedOwnedRequirements = parseSaveBufRequirementRange(
    rangeBuf,
    cachedSaveBufCollectibleMinOff,
    cachedSaveBufCollectibleOffsets,
    collectibles.beanIds,
  )
  return collectibles
}

async function readLiveSaveBufCollectibles(
  mainBase: bigint,
  vtables: DynamicVtables,
): Promise<SaveBufCollectibles | null> {
  if (cachedSaveBufPtr === 0n || !cachedSaveBufCollectibleOffsets) {
    const resolved = await resolveSaveBufCollectibleOffsets(mainBase, vtables)
    if (!resolved) {
      cachedSaveBufCollectibles = null
      cachedOwnedRequirements = null
      return null
    }
  }

  let parsed = await readSaveBufCollectibleRangeFromCache()
  if (parsed === null && lichiiRpc.isConnected()) {
    // Re-scan SaveBuf Sec 1..3 once if saveBufPtr or cached u32 hashes changed
    cachedSaveBufPtr = 0n
    cachedSaveBufCollectibleOffsets = null
    cachedSaveBufCollectibleMinOff = 0
    cachedSaveBufCollectibleMaxEnd = 0
    if (await resolveSaveBufCollectibleOffsets(mainBase, vtables)) {
      parsed = await readSaveBufCollectibleRangeFromCache()
    }
  }

  cachedSaveBufCollectibles = parsed
  if (!parsed) {
    cachedOwnedRequirements = null
  }
  return parsed
}

async function readLiveSkulltulaCount(
  mainBase: bigint,
  vtables: DynamicVtables,
  now: number,
): Promise<number | null> {
  // Fast path: cached Item_Token_Gold.StockNum entry in GameDataMgr + 0x230
  if (cachedLiveStockAddr !== '0x0') {
    const stockBuf = await readMemoryBuffer(cachedLiveStockAddr, 0x28, 400)
    const val = parseGdmStockNumBuffer(stockBuf, vtables.gdmStockVt)
    if (val !== null) return val
    cachedLiveStockAddr = '0x0'
    cachedGdmAddr = 0n
  }

  const gdm = await resolveGameDataMgr(mainBase, vtables)
  if (gdm !== 0n) {
    const resolved = await resolveGdmStockAddrFromContainer(gdm, vtables)
    if (resolved !== null) return resolved
  }

  // Fallback: slid gdmCountVt container entry
  if (cachedLiveGdmCountAddr !== '0x0') {
    const gdmBuf = await readMemoryBuffer(cachedLiveGdmCountAddr, 0x30, 500)
    const countVal = parseGdmSkulltulaCount(gdmBuf, vtables.gdmCountVt)
    if (countVal !== null) return countVal
    cachedLiveGdmCountAddr = '0x0'
  }

  if (lichiiRpc.isConnected() && now - lastGdmRescanTime > 2500) {
    lastGdmRescanTime = now
    const pattern = u64ToLeHex(vtables.gdmCountVt) + '08000000'
    const hits = await searchHeapWithFallback({
      pattern,
      start: '0x2160000000',
      end: '0x21c0000000',
      maxHits: 16,
      fastBudgetMs: 800,
      heapBudgetMs: 1500,
    })
    const candidates: Array<{ hit: string; val: number }> = []
    for (const hit of hits) {
      const candidate = await readMemoryBuffer(hit, 0x30, 500)
      const val = parseGdmSkulltulaCount(candidate, vtables.gdmCountVt)
      if (val !== null) {
        candidates.push({ hit, val })
      }
    }
    if (candidates.length === 1) {
      cachedLiveGdmCountAddr = candidates[0]!.hit
      return candidates[0]!.val
    }
    if (candidates.length > 1) {
      const masterIds = cachedMasterCollectedIds ?? (await readMasterFlagCollectedIds(now, mainBase, vtables))
      const expectedCount = masterIds?.length ?? null
      const chosen =
        (expectedCount !== null ? candidates.find((c) => c.val === expectedCount) : undefined) ??
        candidates[0]!
      cachedLiveGdmCountAddr = chosen.hit
      return chosen.val
    }
  }

  // Last-resort fallback: SaveBuf 0x04735978 index entry
  if (lichiiRpc.isConnected()) {
    if (cachedLiveCountAddr === '0x0' && gdm !== 0n) {
      await resolveSaveBufFallbackAddresses(gdm)
    }
    if (cachedLiveCountAddr !== '0x0') {
      const countBuf = await readMemoryBuffer(cachedLiveCountAddr, 8, 500)
      if (countBuf && countBuf.length === 8 && countBuf.readUInt32LE(0) === GDM_STOCK_TOKEN_HASH) {
        const val = countBuf.readUInt32LE(4)
        if (val >= 0 && val <= 100) return val
      }
    }
  }

  return null
}

export async function readLiveTelemetryFromMemory(): Promise<LiveMemoryTelemetry> {
  const now = Date.now()
  const hadActiveSession =
    cachedLiveScene !== null ||
    cachedParentObjAddr !== 0n ||
    cachedMasterCollectedIds !== null

  let mainBase = await ensureMainBase()
  if (mainBase === 0n) {
    if (hadActiveSession) {
      clearPlayerAndGdmSessionCaches()
    }
    return emptyLiveMemoryTelemetry(!lichiiRpc.isConnected())
  }
  let vtables = deriveDynamicVtables(mainBase)

  // 1. Read Sub[36] (0x40 bytes covers pObj + player pos/dir) concurrently with cached Sub[7] + StockNum when warm
  const canSpeculateWarmReads = cachedSub36Addr !== '0x0'
  const [initialSubBuf, prefetchedPrimaryStrBuf, prefetchedStockBuf] = await Promise.all([
    readMemoryBuffer(cachedSub36Addr, 0x40),
    canSpeculateWarmReads && cachedSub7Addr > MIN_GUEST_HEAP_PTR
      ? readMemoryBuffer(bigintToHex(cachedSub7Addr + 0x34n), 0x80, 400)
      : Promise.resolve(null),
    canSpeculateWarmReads && cachedLiveStockAddr !== '0x0'
      ? readMemoryBuffer(cachedLiveStockAddr, 0x28, 400)
      : Promise.resolve(null),
  ])
  let subBuf = initialSubBuf
  let subValid = isValidSub36Buffer(subBuf, vtables.sub36Vt1, vtables.sub36Vt2)
  const initialSubValid = subValid
  let readFailed = cachedSub36Addr !== '0x0' && subBuf === null

  if (!subValid) {
    // Re-verify mainBase if a previously valid Sub[36] failed (guards against undetected restarts)
    if (cachedSub36Addr !== '0x0' && lichiiRpc.isConnected()) {
      const hdr = await readMemoryBuffer(bigintToHex(mainBase), 8, 400)
      if (!validateMainBaseHeader(hdr)) {
        resetLiveSessionCaches()
        mainBase = await ensureMainBase(true)
        if (mainBase === 0n) {
          return emptyLiveMemoryTelemetry(!lichiiRpc.isConnected())
        }
        vtables = deriveDynamicVtables(mainBase)
      }
    }

    cachedSub36Addr = '0x0'
    cachedParentObjAddr = 0n
    cachedSub7Addr = 0n
    cachedSub23Addr = 0n

    // Fast path (~1ms): resolve Sub[36] / Sub[7] / Sub[23] directly from .bss singleton
    if (lichiiRpc.isConnected()) {
      subBuf = await resolvePlayerFromBss(mainBase, vtables)
      subValid = isValidSub36Buffer(subBuf, vtables.sub36Vt1, vtables.sub36Vt2)
      readFailed = subBuf === null
    }

    // Fallback: slid-vtable / "Work/Banc/Scene/" heap scan when .bss pointer is not yet populated
    if (!subValid) {
      if (hadActiveSession) {
        clearPlayerAndGdmSessionCaches()
      }
      if (lichiiRpc.isConnected() && now - lastRescanTime > 2500) {
        lastRescanTime = now
        subBuf = await resolvePlayerViaHeapFallbacks(vtables)
        subValid = isValidSub36Buffer(subBuf, vtables.sub36Vt1, vtables.sub36Vt2)
        readFailed = subBuf === null
      }
    }
  }

  if (!subValid || !subBuf) {
    return emptyLiveMemoryTelemetry(readFailed || !lichiiRpc.isConnected())
  }

  const prevScene = cachedLiveScene
  const pObj = subBuf.readBigUInt64LE(0x10)
  const x = subBuf.readFloatLE(0x1c)
  const y = subBuf.readFloatLE(0x20)
  const z = subBuf.readFloatLE(0x24)
  const dx = subBuf.readFloatLE(0x28)
  const dz = subBuf.readFloatLE(0x30)

  let yaw = 0
  if (Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > 0.01) {
    yaw = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360
  }

  const position = {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    z: Number(z.toFixed(2)),
    yaw: Number(yaw.toFixed(1)),
  }

  // Refresh scene name from Sub[7] + 0x34 (fallback pObj + 0x768) and age hint from Sub[23] + 0x80
  if (pObj > MIN_GUEST_HEAP_PTR) {
    let primaryStrBuf: Buffer | null = null
    if (pObj !== cachedParentObjAddr) {
      cachedParentObjAddr = pObj
      const subs = await resolveSubPointersFromPObj(pObj, vtables, false)
      if (subs) {
        cachedSub7Addr = subs.sub7Ptr > MIN_GUEST_HEAP_PTR ? subs.sub7Ptr : 0n
        cachedSub23Addr = subs.sub23Ptr > MIN_GUEST_HEAP_PTR ? subs.sub23Ptr : 0n
      }
      primaryStrBuf =
        cachedSub7Addr > MIN_GUEST_HEAP_PTR
          ? await readMemoryBuffer(bigintToHex(cachedSub7Addr + 0x34n), 0x80, 400)
          : null
    } else if (cachedSub7Addr > MIN_GUEST_HEAP_PTR) {
      primaryStrBuf =
        initialSubValid && prefetchedPrimaryStrBuf !== null
          ? prefetchedPrimaryStrBuf
          : await readMemoryBuffer(bigintToHex(cachedSub7Addr + 0x34n), 0x80, 400)
    }
    let bcettMatch =
      primaryStrBuf
        ?.toString('ascii')
        .match(/Work\/Banc\/Scene\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\.bcett/) ?? null
    if (!bcettMatch) {
      const fallbackStrBuf = await readMemoryBuffer(bigintToHex(pObj + 0x768n), 0x480, 500)
      bcettMatch =
        fallbackStrBuf
          ?.toString('ascii')
          .match(/Work\/Banc\/Scene\/([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)\.bcett/) ?? null
    }
    if (bcettMatch) {
      const norm = normalizeSceneName(bcettMatch[2] || bcettMatch[1] || '')
      if (norm.scene !== prevScene) {
        cachedLiveScene = norm.scene
        cachedLiveAgeHint = norm.ageHint
      } else if (norm.ageHint !== null) {
        cachedLiveAgeHint = norm.ageHint
      }
    }

    const sceneChanged = cachedLiveScene !== prevScene
    if (!cachedLiveAgeHint && lichiiRpc.isConnected() && (sceneChanged || now - lastAgeReadTime > 1000)) {
      lastAgeReadTime = now
      if (cachedSub23Addr > MIN_GUEST_HEAP_PTR) {
        const adjBuf = await readMemoryBuffer(bigintToHex(cachedSub23Addr + 0x80n), 0x80, 400)
        if (adjBuf) {
          const adjAscii = readNullTerminatedAscii(adjBuf, 0, 0x80)
          if (adjAscii.includes('_Adult')) cachedLiveAgeHint = 'adult'
          else if (adjAscii.includes('_Child')) cachedLiveAgeHint = 'child'
        }
      }
    }
  }

  if (!lichiiRpc.isConnected()) {
    return emptyLiveMemoryTelemetry(true)
  }

  // 2. Read live runtime GameDataMgr StockNum (direct GDM + 0x230 hash table, or slid fallback)
  const prefetchedStockVal =
    initialSubValid && prefetchedStockBuf !== null
      ? parseGdmStockNumBuffer(prefetchedStockBuf, vtables.gdmStockVt)
      : null
  const liveSkulltulaCount =
    prefetchedStockVal !== null
      ? prefetchedStockVal
      : await readLiveSkulltulaCount(mainBase, vtables, now)

  // 3. Refresh authoritative 100-Skulltula + Heart runtime flag tables on pickup, scene change, or every 500ms
  // 3b. Refresh Type 2 Heart Piece, Bean, Great Fairy & Bottle flags from live GameDataMgr containers
  // (gdm + 0x170 Bool, gdm + 0x230 Int), falling back to SaveBuf Sec 1 & Sec 3 if unavailable.
  let masterCollectedIds = cachedMasterCollectedIds
  let masterHeartContainerIds = cachedMasterHeartContainerIds
  let masterHeartPieceIds = cachedMasterHeartPieceIds
  let saveBufCollectibles = cachedSaveBufCollectibles
  const masterNeedsRefresh =
    masterCollectedIds === null ||
    liveSkulltulaCount !== prevMasterReadCount ||
    cachedLiveScene !== prevScene ||
    now - lastMasterReadTime > 500
  const gdmNeedsRefresh =
    saveBufCollectibles === null
      ? now - lastSaveBufCollectibleReadTime > 500
      : masterNeedsRefresh || now - lastSaveBufCollectibleReadTime > 500

  if (lichiiRpc.isConnected() && (masterNeedsRefresh || gdmNeedsRefresh)) {
    if (gdmNeedsRefresh) {
      lastSaveBufCollectibleReadTime = now
    }
    const [fetchedMasterIds, liveGdmCollectibles] = await Promise.all([
      masterNeedsRefresh ? readMasterFlagCollectedIds(now, mainBase, vtables) : Promise.resolve(undefined),
      gdmNeedsRefresh ? readLiveGdmCollectibles(mainBase, vtables) : Promise.resolve(undefined),
    ])
    if (masterNeedsRefresh) {
      masterCollectedIds = fetchedMasterIds ?? null
      masterHeartContainerIds = cachedMasterHeartContainerIds
      masterHeartPieceIds = cachedMasterHeartPieceIds
      prevMasterReadCount = liveSkulltulaCount
    }
    if (gdmNeedsRefresh) {
      if (liveGdmCollectibles !== null && liveGdmCollectibles !== undefined) {
        cachedSaveBufCollectibles = liveGdmCollectibles
        saveBufCollectibles = liveGdmCollectibles
      } else {
        saveBufCollectibles = await readLiveSaveBufCollectibles(mainBase, vtables)
      }
    }
  }

  // 4. Fallback to RAM SaveBuf 0xa3db7114 array only if master table was unavailable
  if (
    lichiiRpc.isConnected() &&
    masterCollectedIds === null &&
    (cachedLiveScene !== prevScene || now - lastHashesReadTime > 1000)
  ) {
    lastHashesReadTime = now
    if (cachedLiveHashesAddr === '0x0') {
      const gdm = await resolveGameDataMgr(mainBase, vtables)
      await resolveSaveBufFallbackAddresses(gdm)
    }
    const hashesBuf = await readMemoryBuffer(cachedLiveHashesAddr, 3216, 600)
    if (hashesBuf && hashesBuf.length >= 64) {
      const first = hashesBuf.readBigUInt64LE(0)
      const second = hashesBuf.readBigUInt64LE(8)
      if (first > 0n && second > first) {
        const nextSet = new Set<bigint>()
        let strictlySorted = true
        let prev = 0n
        for (let off = 0; off + 8 <= hashesBuf.length; off += 8) {
          const h = hashesBuf.readBigUInt64LE(off)
          if (h === 0n) break
          if (h <= prev) {
            strictlySorted = false
            break
          }
          prev = h
          nextSet.add(h)
        }
        if (strictlySorted && nextSet.size >= 2) {
          cachedLiveSavedHashes = nextSet
        }
      }
    }
  }

  if (!lichiiRpc.isConnected()) {
    return emptyLiveMemoryTelemetry(true)
  }

  return {
    position,
    scene: cachedLiveScene,
    ageHint: cachedLiveAgeHint,
    masterCollectedIds,
    masterHeartContainerIds,
    masterHeartPieceIds,
    saveBufCollectibles,
    ownedRequirements: cachedOwnedRequirements,
    liveSavedHashes: cachedLiveSavedHashes,
    liveSkulltulaCount,
    readFailed: false,
  }
}
