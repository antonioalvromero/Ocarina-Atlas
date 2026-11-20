import type http from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import type { LichiiTelemetryState } from './lichii-types'
import {
  getSyncState,
  handleSyncApiRequest,
  isCrossSiteRequest,
  isJsonContentType,
  subscribeSyncUpdates,
} from './sync-server'
import type { Place } from './types'
import {
  buildGdmBoolWindows,
  classifyGdmCollectibles,
  classifyGdmRequirements,
  collectIdsFromHashMap,
  type GdmBoolWindowDescriptor,
  GHOST_SHOP_COUPON_BOTTLE_ITEM_ID,
  GHOST_SHOP_COUPON_NUM_HASH,
  GHOST_SHOP_COUPON_THRESHOLD,
  KNOWN_BEAN_BOOL_HASH_MAP,
  KNOWN_BOTTLE_BOOL_HASH_MAP,
  KNOWN_FAIRY_BOOL_HASH_MAP,
  KNOWN_HEART_CONTAINER_HASH_MAP,
  KNOWN_HEART_PIECE_BOOL_HASH_MAP,
  KNOWN_HEART_PIECE_HASH_MAP,
  KNOWN_REQUIREMENT_BOOL_HASH_MAP,
  KNOWN_SKULLTULA_HASH_MAP,
  KNOWN_THOUGHT_BOOL_HASH_MAP,
  parseGdmBoolEntryBuffer,
  parseGdmIntEntryBuffer,
  parseGdmSkulltulaCount,
  parseGdmStockNumBuffer,
  parseMasterFlagTableBuffer,
  parseMasterFlagTableChunks,
  parseSaveBufCollectibleRange,
  parseSaveBufHeartPieceBoolRange,
  type SaveBufCollectibles,
  scanGdmContainerHashTableBuffer,
} from './lichii/collectible-hashes'
import {
  determineDungeonFloor,
  determineMapId,
  type MapCaptureConfig,
  normalizeSceneName,
  placesById,
  projectToPlaceMap,
  projectToWorldMap,
  resolveEffectiveScene,
  SCENE_TO_PLACE,
  setStaticAssetRoots,
} from './lichii/coordinate-projection'
import {
  clearPlayerAndGdmSessionCaches,
  emptyLiveMemoryTelemetry,
  type LiveMemoryTelemetry,
  readLiveTelemetryFromMemory,
  registerSessionCacheResetListener,
  resetLiveSessionCaches,
} from './lichii/memory-reader'
import {
  callLichiiRpc,
  closeLichiiRpc,
  deriveDynamicVtables,
  type DynamicVtables,
  ensureMainBase,
  getLichiiHost,
  getLichiiPort,
  getMinGuestHeapPtr,
  isValidSub36Buffer,
  LichiiRpcClient,
  type LichiiRpcClientOptions,
  lichiiRpc,
  parseGdmContainerHeader,
  parseLichiiPort,
  registerRpcDisconnectListener,
  updateMinGuestHeapPtr,
  validateMainBaseHeader,
} from './lichii/rpc-client'
import {
  detectEmulatorFromPath,
  findLatestSaveSlotDir,
  getCachedLatestSlotInfo,
  getCachedSaveState,
  getCandidateSaveDirs,
  getLastSaveSlotScanTime,
  getRuntimeCustomSaveDir,
  isUncSavePath,
  type ParsedSaveSlot,
  parseSaveSlot,
  refreshCachedSaveSlotSelection,
  registerSaveSelectionResetListener,
  resolveSaveSlotSelection,
  type SaveSlotSelectionResult,
  setCustomSaveOverride,
  setSelectedSaveSlot,
} from './lichii/save-parser'

export {
  buildGdmBoolWindows,
  classifyGdmCollectibles,
  classifyGdmRequirements,
  clearPlayerAndGdmSessionCaches,
  closeLichiiRpc,
  deriveDynamicVtables,
  detectEmulatorFromPath,
  determineDungeonFloor,
  ensureMainBase,
  findLatestSaveSlotDir,
  GHOST_SHOP_COUPON_BOTTLE_ITEM_ID,
  GHOST_SHOP_COUPON_NUM_HASH,
  GHOST_SHOP_COUPON_THRESHOLD,
  getCandidateSaveDirs,
  getLichiiHost,
  getLichiiPort,
  getMinGuestHeapPtr,
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
  parseGdmBoolEntryBuffer,
  parseGdmContainerHeader,
  parseGdmIntEntryBuffer,
  parseGdmSkulltulaCount,
  parseGdmStockNumBuffer,
  parseLichiiPort,
  parseMasterFlagTableBuffer,
  parseMasterFlagTableChunks,
  parseSaveBufCollectibleRange,
  parseSaveBufHeartPieceBoolRange,
  parseSaveSlot,
  projectToPlaceMap,
  readLiveTelemetryFromMemory,
  resetLiveSessionCaches,
  resolveEffectiveScene,
  resolveSaveSlotSelection,
  SCENE_TO_PLACE,
  scanGdmContainerHashTableBuffer,
  setCustomSaveOverride,
  setSelectedSaveSlot,
  setStaticAssetRoots,
  validateMainBaseHeader,
}
export type {
  DynamicVtables,
  GdmBoolWindowDescriptor,
  LichiiRpcClientOptions,
  LiveMemoryTelemetry,
  MapCaptureConfig,
  ParsedSaveSlot,
  SaveBufCollectibles,
  SaveSlotSelectionResult,
}

/**
 * Derives public RPC connectivity, running state, and telemetry source without
 * letting disk saves impersonate an active emulator connection.
 */
export function deriveConnectionStatus(params: {
  tcpConnected: boolean
  emulatorRunning: boolean
  hasLivePosition: boolean
  hasSavePosition: boolean
}): {
  connected: boolean
  emulatorRunning: boolean
  source: 'memory' | 'save' | 'none'
} {
  const connected = params.tcpConnected
  const emulatorRunning = params.tcpConnected && params.emulatorRunning
  const source: 'memory' | 'save' | 'none' =
    emulatorRunning && params.hasLivePosition
      ? 'memory'
      : params.hasSavePosition
        ? 'save'
        : 'none'

  return { connected, emulatorRunning, source }
}

/** Clears stale disk save item names while streaming live RAM telemetry. */
export function deriveLastPickedItem(
  source: 'memory' | 'save' | 'none',
  saveLastPickedItem: string | null,
): string | null {
  return source === 'memory' ? null : saveLastPickedItem
}

// ============================================================================
// Main Telemetry Aggregator
// ============================================================================

const STATE_CACHE_TTL_MS = 80
let stickyLastCollectedId: string | null = null
let prevMasterCollectedSet: Set<string> | null = null

let cachedStatusRes: Record<string, unknown> | null = null
let lastStatusCheckTime = 0
let cachedTelemetryState: LichiiTelemetryState | null = null
let cachedTelemetryStateTime = 0
let inFlightStatePromise: Promise<LichiiTelemetryState> | null = null

registerSessionCacheResetListener(() => {
  prevMasterCollectedSet = null
  stickyLastCollectedId = null
})

function handleRpcDisconnect() {
  cachedStatusRes = null
  updateMinGuestHeapPtr(null)
  lastStatusCheckTime = 0
  cachedTelemetryState = null
  cachedTelemetryStateTime = 0
  resetLiveSessionCaches()
}

registerRpcDisconnectListener(() => {
  handleRpcDisconnect()
})

registerSaveSelectionResetListener(() => {
  cachedTelemetryState = null
  cachedTelemetryStateTime = 0
})

export async function getLichiiTelemetryState(): Promise<LichiiTelemetryState> {
  const now = Date.now()
  if (
    cachedTelemetryState &&
    now - cachedTelemetryStateTime < STATE_CACHE_TTL_MS &&
    (!cachedTelemetryState.connected || lichiiRpc.isConnected())
  ) {
    return cachedTelemetryState
  }
  if (inFlightStatePromise) {
    return inFlightStatePromise
  }

  inFlightStatePromise = computeLichiiTelemetryState()
    .then((state) => {
      if (!state.connected || lichiiRpc.isConnected()) {
        cachedTelemetryState = state
        cachedTelemetryStateTime = Date.now()
      } else {
        cachedTelemetryState = null
        cachedTelemetryStateTime = 0
      }
      return state
    })
    .finally(() => {
      inFlightStatePromise = null
    })

  return inFlightStatePromise
}

async function computeLichiiTelemetryState(): Promise<LichiiTelemetryState> {
  const now = Date.now()
  // Always pass fps_window_ms: 0 so status responds in <1ms instead of sleeping 500ms,
  // and refresh full status every 1s (or immediately when disconnected).
  if (
    !lichiiRpc.isConnected() ||
    !cachedStatusRes ||
    !cachedStatusRes.powered_on ||
    now - lastStatusCheckTime > 1000
  ) {
    const freshStatus = await callLichiiRpc('status', { fps_window_ms: 0 }, 700)
    lastStatusCheckTime = Date.now()
    cachedStatusRes = freshStatus
    updateMinGuestHeapPtr(freshStatus)
  }

  let tcpConnected = cachedStatusRes !== null && lichiiRpc.isConnected()
  let emulatorRunning = tcpConnected && Boolean(cachedStatusRes?.powered_on)
  let titleId = typeof cachedStatusRes?.program_id === 'string' ? cachedStatusRes.program_id : undefined

  let liveState =
    tcpConnected && emulatorRunning
      ? await readLiveTelemetryFromMemory()
      : emptyLiveMemoryTelemetry()

  // If cached status assumed alive but memory read returned nothing, re-check status right away
  if (
    tcpConnected &&
    emulatorRunning &&
    !liveState.position &&
    (!lichiiRpc.isConnected() ||
      !cachedStatusRes ||
      liveState.readFailed ||
      Date.now() - lastStatusCheckTime > 50)
  ) {
    const wasDisconnected = !lichiiRpc.isConnected()
    const freshStatus = await callLichiiRpc('status', { fps_window_ms: 0 }, 700)
    lastStatusCheckTime = Date.now()
    cachedStatusRes = freshStatus
    updateMinGuestHeapPtr(freshStatus)
    tcpConnected = freshStatus !== null && lichiiRpc.isConnected()
    emulatorRunning = tcpConnected && Boolean(freshStatus?.powered_on)
    titleId = typeof freshStatus?.program_id === 'string' ? freshStatus.program_id : undefined
    if (!tcpConnected || !emulatorRunning) {
      resetLiveSessionCaches()
      liveState = emptyLiveMemoryTelemetry()
    } else if (wasDisconnected) {
      liveState = await readLiveTelemetryFromMemory()
    }
  } else if (!tcpConnected || !emulatorRunning) {
    resetLiveSessionCaches()
  }

  // Skip synchronous save-directory I/O when live memory already provides position and scene,
  // except on initial scan (or after a runtime slot/folder override) so save metadata stays populated.
  const needsSaveFallback = !tcpConnected || !emulatorRunning || !liveState.position || !liveState.scene
  if (!needsSaveFallback && getLastSaveSlotScanTime() === 0) {
    refreshCachedSaveSlotSelection()
  }
  const saveState = needsSaveFallback ? getCachedSaveState() : null

  const { connected, emulatorRunning: activeEmulatorRunning, source } = deriveConnectionStatus({
    tcpConnected,
    emulatorRunning,
    hasLivePosition: liveState.position !== null,
    hasSavePosition: Boolean(saveState?.position),
  })

  const position = liveState.position ?? saveState?.position ?? null
  const rawScene = liveState.scene ?? saveState?.subScene ?? saveState?.scene ?? null
  const { scene: normalizedScene, ageHint: sceneAgeHint } = normalizeSceneName(rawScene)
  const baseSceneKey = normalizedScene ?? (saveState?.scene ? normalizeSceneName(saveState.scene).scene : null)
  const sceneKey = resolveEffectiveScene(baseSceneKey, position?.x ?? null, position?.z ?? null)

  const sceneMapping = sceneKey ? SCENE_TO_PLACE[sceneKey] : undefined
  const place: Place | undefined = sceneMapping ? placesById.get(sceneMapping.placeId) : undefined

  const age: 'child' | 'adult' | null =
    sceneAgeHint ??
    liveState.ageHint ??
    sceneMapping?.defaultAge ??
    (saveState ? 'adult' : null)

  const mapId = place ? determineMapId(place, age, position?.y ?? null) : null
  const mapFraction =
    place && sceneKey && position
      ? projectToPlaceMap(sceneKey, place, mapId, position.x, position.z)
      : null
  const worldMapFraction = place ? projectToWorldMap(place, mapFraction) : null

  const skulltulaCount =
    source === 'memory'
      ? (liveState.liveSkulltulaCount ??
          (liveState.masterCollectedIds ? liveState.masterCollectedIds.length : null))
      : (saveState?.skulltulaCount ?? null)
  const lastPickedItem = deriveLastPickedItem(source, saveState?.lastPickedItem ?? null)

  let collectedSkulltulaIds: string[] = []
  let authoritativeSkulltulas = false
  let collectedHeartContainerIds: string[] = []
  let authoritativeHeartContainers = false
  let collectedHeartPieceIds: string[] = []
  let authoritativeHeartPieces = false
  let collectedBeanIds: string[] = []
  let authoritativeBeans = false
  let collectedFairyIds: string[] = []
  let authoritativeFairies = false
  let collectedBottleIds: string[] = []
  let authoritativeBottles = false
  let collectedThoughtIds: string[] = []
  let authoritativeThoughts = false

  if (source === 'memory' && place && liveState.masterCollectedIds !== null) {
    collectedSkulltulaIds = liveState.masterCollectedIds
    authoritativeSkulltulas = true
    collectedHeartContainerIds = liveState.masterHeartContainerIds ?? []
    authoritativeHeartContainers = liveState.masterHeartContainerIds !== null

    const saveBufHpIds = liveState.saveBufCollectibles?.heartPieceIds ?? null
    const mergedHeartPieces = new Set<string>(liveState.masterHeartPieceIds ?? [])
    if (saveBufHpIds) {
      for (const id of saveBufHpIds) {
        mergedHeartPieces.add(id)
      }
    }
    collectedHeartPieceIds = Array.from(mergedHeartPieces).sort()
    authoritativeHeartPieces = liveState.masterHeartPieceIds !== null && saveBufHpIds !== null

    if (liveState.saveBufCollectibles) {
      collectedBeanIds = liveState.saveBufCollectibles.beanIds
      authoritativeBeans = true
      collectedFairyIds = liveState.saveBufCollectibles.fairyIds
      authoritativeFairies = true
      collectedBottleIds = liveState.saveBufCollectibles.bottleIds
      authoritativeBottles = true
      collectedThoughtIds = liveState.saveBufCollectibles.thoughtIds
      authoritativeThoughts = true
    }

    const currentSet = new Set(collectedSkulltulaIds)
    if (prevMasterCollectedSet !== null) {
      const newlyAdded = collectedSkulltulaIds.filter((id) => !prevMasterCollectedSet!.has(id))
      let removedAny = false
      for (const prevId of prevMasterCollectedSet) {
        if (!currentSet.has(prevId)) {
          removedAny = true
          break
        }
      }
      if (removedAny || newlyAdded.length > 2) {
        // Reloaded a save or switched save slots: clear stale pickup badge
        stickyLastCollectedId = null
      } else if (newlyAdded.length >= 1) {
        stickyLastCollectedId = newlyAdded[newlyAdded.length - 1] ?? null
      }
    }
    prevMasterCollectedSet = currentSet
  } else {
    prevMasterCollectedSet = null
    // Fallback without master table: never mix disk progress.sav across slots when RAM is active
    const fallbackHashes =
      source === 'memory' && liveState.liveSavedHashes.size > 0
        ? liveState.liveSavedHashes
        : source === 'save' && saveState?.savedHashes
          ? saveState.savedHashes
          : null
    const fallbackBoolHeartPieces =
      source === 'memory'
        ? liveState.saveBufCollectibles?.heartPieceIds ?? null
        : source === 'save'
          ? saveState?.savedHeartPieceBoolIds ?? null
          : null
    if (fallbackHashes || fallbackBoolHeartPieces) {
      if (fallbackHashes) {
        collectedSkulltulaIds = collectIdsFromHashMap(KNOWN_SKULLTULA_HASH_MAP, fallbackHashes)
        collectedHeartContainerIds = collectIdsFromHashMap(
          KNOWN_HEART_CONTAINER_HASH_MAP,
          fallbackHashes,
        )
      }
      const mergedFallbackHeartPieces = new Set<string>(
        fallbackHashes ? collectIdsFromHashMap(KNOWN_HEART_PIECE_HASH_MAP, fallbackHashes) : [],
      )
      if (fallbackBoolHeartPieces) {
        for (const id of fallbackBoolHeartPieces) {
          mergedFallbackHeartPieces.add(id)
        }
      }
      collectedHeartPieceIds = Array.from(mergedFallbackHeartPieces).sort()
    }
    if (source === 'memory' && liveState.saveBufCollectibles) {
      collectedBeanIds = liveState.saveBufCollectibles.beanIds
      authoritativeBeans = true
      collectedFairyIds = liveState.saveBufCollectibles.fairyIds
      authoritativeFairies = true
      collectedBottleIds = liveState.saveBufCollectibles.bottleIds
      authoritativeBottles = true
      collectedThoughtIds = liveState.saveBufCollectibles.thoughtIds
      authoritativeThoughts = true
    } else if (source === 'save' && saveState) {
      collectedBeanIds = saveState.savedBeanIds
      collectedFairyIds = saveState.savedFairyIds
      collectedBottleIds = saveState.savedBottleIds
      collectedThoughtIds = saveState.savedThoughtIds
    }
  }

  const cachedLatestSlotInfo = getCachedLatestSlotInfo()
  const rpcEmulator =
    cachedStatusRes?.emulator === 'longshot' ||
    cachedStatusRes?.emulator === 'relink' ||
    cachedStatusRes?.emulator === 'triforce' ||
    cachedStatusRes?.emulator === 'cheezyemu' ||
    cachedStatusRes?.emulator === 'fritchii' ||
    cachedStatusRes?.emulator === 'lichii' ||
    cachedStatusRes?.emulator === 'eden' ||
    cachedStatusRes?.emulator === 'nx2saria' ||
    cachedStatusRes?.emulator === 'ootpc'
      ? cachedStatusRes.emulator
      : undefined
  const emulator =
    rpcEmulator ?? (cachedLatestSlotInfo ? detectEmulatorFromPath(cachedLatestSlotInfo.dir) : undefined)

  const ownedRequirements =
    source === 'memory'
      ? (liveState.ownedRequirements ?? undefined)
      : source === 'save'
        ? saveState?.savedRequirementKeys
        : undefined

  return {
    connected,
    emulatorRunning: activeEmulatorRunning,
    ...(emulator ? { emulator } : {}),
    titleId,
    scene: sceneKey,
    placeId: place?.id ?? null,
    placeSlug: place?.slug ?? null,
    placeName: place?.name ?? null,
    mapId,
    age,
    position,
    mapFraction,
    worldMapFraction,
    skulltulaCount,
    collectedSkulltulaIds,
    authoritativeSkulltulas,
    collectedHeartContainerIds,
    authoritativeHeartContainers,
    collectedHeartPieceIds,
    authoritativeHeartPieces,
    collectedBeanIds,
    authoritativeBeans,
    collectedFairyIds,
    authoritativeFairies,
    collectedBottleIds,
    authoritativeBottles,
    collectedThoughtIds,
    authoritativeThoughts,
    ...(ownedRequirements !== undefined ? { ownedRequirements } : {}),
    lastCollectedSkulltulaId: stickyLastCollectedId,
    lastPickedItem,
    activeSaveDir: cachedLatestSlotInfo?.profileDir ?? getRuntimeCustomSaveDir() ?? null,
    activeSaveSlot: cachedLatestSlotInfo?.slotName ?? null,
    availableSaveSlots: cachedLatestSlotInfo?.availableSaveSlots ?? [],
    source,
    updatedAt: Date.now(),
  }
}

function createOfflineFallbackState(): LichiiTelemetryState {
  return {
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
    collectedHeartContainerIds: [],
    authoritativeHeartContainers: false,
    collectedHeartPieceIds: [],
    authoritativeHeartPieces: false,
    collectedBeanIds: [],
    authoritativeBeans: false,
    collectedFairyIds: [],
    authoritativeFairies: false,
    collectedBottleIds: [],
    authoritativeBottles: false,
    collectedThoughtIds: [],
    authoritativeThoughts: false,
    lastCollectedSkulltulaId: null,
    lastPickedItem: null,
    source: 'none',
    updatedAt: Date.now(),
  }
}

async function getSafeTelemetryState(): Promise<LichiiTelemetryState> {
  try {
    return await getLichiiTelemetryState()
  } catch {
    return createOfflineFallbackState()
  }
}

function isLiveTelemetryState(state: LichiiTelemetryState): boolean {
  return state.connected && state.emulatorRunning && state.source === 'memory'
}

function serializeComparableTelemetry(state: LichiiTelemetryState): string {
  return JSON.stringify({ ...state, updatedAt: 0 })
}

export const MAX_SSE_CLIENTS = 32

/** Returns true if the HTTP request originated from a loopback interface. */
export function isLoopbackRequest(req: http.IncomingMessage): boolean {
  const rawAddr = req.socket?.remoteAddress?.trim().toLowerCase()
  if (!rawAddr) return false
  return rawAddr === '127.0.0.1' || rawAddr === '::1' || rawAddr === '::ffff:127.0.0.1'
}

/** Redacts OS user paths from telemetry state before sending to non-loopback clients. */
export function redactTelemetryStateForRemote(state: LichiiTelemetryState): LichiiTelemetryState {
  const rawDir = state.activeSaveDir
  if (typeof rawDir !== 'string' || !rawDir.trim()) {
    return state
  }
  const normalized = rawDir.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/')
  const redacted = path.posix.basename(normalized) || null
  return {
    ...state,
    activeSaveDir: redacted,
  }
}

/** Returns full telemetry state for loopback clients and redacted state for remote clients. */
export function sanitizeTelemetryStateForRequest(
  state: LichiiTelemetryState,
  req: http.IncomingMessage,
): LichiiTelemetryState {
  return isLoopbackRequest(req) ? state : redactTelemetryStateForRemote(state)
}

interface SseClient {
  isLoopback: boolean
  write: (chunk: string) => boolean
  close: () => void
}

const sseClients = new Set<SseClient>()
let ssePollTimer: ReturnType<typeof setTimeout> | null = null
let sseKeepaliveTimer: ReturnType<typeof setInterval> | null = null
let sseUnsubscribeSync: (() => void) | null = null
let sseLastComparable = ''
let sseLastTelemetryFrame = ''
let sseLastRedactedTelemetryFrame = ''
let sseBroadcasterEpoch = 0

function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function broadcastSseFrame(frame: string): void {
  for (const client of [...sseClients]) {
    if (!client.write(frame)) {
      client.close()
    }
  }
}

function broadcastTelemetryStateToSse(state: LichiiTelemetryState): void {
  const comparable = serializeComparableTelemetry(state)
  if (comparable === sseLastComparable) return
  sseLastComparable = comparable
  sseLastTelemetryFrame = formatSseEvent('telemetry', state)
  sseLastRedactedTelemetryFrame = formatSseEvent('telemetry', redactTelemetryStateForRemote(state))
  for (const client of [...sseClients]) {
    const frame = client.isLoopback ? sseLastTelemetryFrame : sseLastRedactedTelemetryFrame
    if (!client.write(frame)) {
      client.close()
    }
  }
}

function stopSseBroadcasterIfIdle(): void {
  if (sseClients.size > 0) return
  sseBroadcasterEpoch++
  if (ssePollTimer !== null) {
    clearTimeout(ssePollTimer)
    ssePollTimer = null
  }
  if (sseKeepaliveTimer !== null) {
    clearInterval(sseKeepaliveTimer)
    sseKeepaliveTimer = null
  }
  if (sseUnsubscribeSync !== null) {
    sseUnsubscribeSync()
    sseUnsubscribeSync = null
  }
  sseLastComparable = ''
  sseLastTelemetryFrame = ''
  sseLastRedactedTelemetryFrame = ''
}

function startSseBroadcaster(): void {
  const epoch = sseBroadcasterEpoch
  if (sseKeepaliveTimer === null) {
    sseKeepaliveTimer = setInterval(() => {
      if (sseClients.size === 0) {
        stopSseBroadcasterIfIdle()
        return
      }
      broadcastSseFrame(': keepalive\n\n')
    }, 15000)
    sseKeepaliveTimer.unref?.()
  }

  if (sseUnsubscribeSync === null) {
    sseUnsubscribeSync = subscribeSyncUpdates((syncState) => {
      broadcastSseFrame(formatSseEvent('sync', syncState))
    })
  }

  const runTick = async () => {
    if (sseClients.size === 0 || epoch !== sseBroadcasterEpoch) return
    const state = await getSafeTelemetryState()
    if (sseClients.size === 0 || epoch !== sseBroadcasterEpoch) return

    broadcastTelemetryStateToSse(state)

    const delayMs = isLiveTelemetryState(state) ? 120 : 750
    ssePollTimer = setTimeout(() => {
      void runTick()
    }, delayMs)
    ssePollTimer.unref?.()
  }

  void runTick()
}

/** Handles `GET /api/lichii/stream` Server-Sent Events for live telemetry and sync state. */
export function handleLichiiStreamRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    const body = JSON.stringify({ error: 'Too many active stream connections' })
    res.writeHead(503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Length': Buffer.byteLength(body).toString(),
    })
    res.end(body)
    return
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()

  let closed = false
  const loopback = isLoopbackRequest(req)

  const cleanup = () => {
    if (closed) return
    closed = true
    sseClients.delete(client)
    req.off('close', cleanup)
    res.off('close', cleanup)
    stopSseBroadcasterIfIdle()
  }

  const client: SseClient = {
    isLoopback: loopback,
    write: (chunk: string) => {
      if (closed || res.writableEnded || res.destroyed) return false
      try {
        res.write(chunk)
        return true
      } catch {
        return false
      }
    },
    close: cleanup,
  }

  req.on('close', cleanup)
  res.on('close', cleanup)
  sseClients.add(client)

  // Push current sync state immediately without waiting for telemetry I/O.
  if (!client.write(formatSseEvent('sync', getSyncState()))) {
    cleanup()
    return
  }

  if (sseClients.size === 1) {
    startSseBroadcaster()
  } else {
    const cachedFrame = loopback ? sseLastTelemetryFrame : sseLastRedactedTelemetryFrame
    if (cachedFrame && !client.write(cachedFrame)) {
      cleanup()
    }
  }
}

const MAX_SAVE_SLOT_BODY_BYTES = 16 * 1024

function sendSaveSlotJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Length': Buffer.byteLength(json).toString(),
  })
  res.end(json)
}

function readSaveSlotJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let settled = false

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    }

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      totalBytes += buf.byteLength
      if (totalBytes > MAX_SAVE_SLOT_BODY_BYTES) {
        req.destroy()
        fail(new RangeError('Payload too large'))
        return
      }
      chunks.push(buf)
    })

    req.on('end', () => {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw) as unknown)
      } catch {
        reject(new SyntaxError('Invalid JSON'))
      }
    })

    req.on('error', (err) => {
      fail(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

/** Handles `POST /api/saves/slot` (`{ slot?: string | null, saveDir?: string | null }`). Returns true if matched. */
export async function handleSaveSlotApiRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname !== '/api/saves/slot') {
    return false
  }

  const method = (req.method || 'GET').toUpperCase()
  if (method !== 'POST') {
    res.setHeader('Allow', 'POST')
    sendSaveSlotJson(res, 405, { error: 'Method not allowed' })
    return true
  }

  if (!isLoopbackRequest(req)) {
    sendSaveSlotJson(res, 403, { error: 'Save slot switching is only allowed from loopback clients' })
    return true
  }

  if (isCrossSiteRequest(req)) {
    sendSaveSlotJson(res, 403, { error: 'Cross-site requests are not allowed' })
    return true
  }

  if (!isJsonContentType(req)) {
    sendSaveSlotJson(res, 415, { error: 'Content-Type must be application/json' })
    return true
  }

  let parsedBody: unknown
  try {
    parsedBody = await readSaveSlotJsonBody(req)
  } catch (err) {
    if (err instanceof RangeError) {
      sendSaveSlotJson(res, 413, { error: 'Payload too large' })
      return true
    }
    sendSaveSlotJson(res, 400, { error: 'Invalid JSON body' })
    return true
  }

  if (typeof parsedBody !== 'object' || parsedBody === null || Array.isArray(parsedBody)) {
    sendSaveSlotJson(res, 400, { error: 'Invalid save slot payload' })
    return true
  }

  const body = parsedBody as Record<string, unknown>
  const hasSlot = Object.prototype.hasOwnProperty.call(body, 'slot')
  const hasSaveDir = Object.prototype.hasOwnProperty.call(body, 'saveDir')

  if (hasSlot && body.slot !== null && body.slot !== undefined && typeof body.slot !== 'string') {
    sendSaveSlotJson(res, 400, { error: 'Invalid slot value' })
    return true
  }
  if (hasSaveDir && body.saveDir !== null && body.saveDir !== undefined && typeof body.saveDir !== 'string') {
    sendSaveSlotJson(res, 400, { error: 'Invalid saveDir value' })
    return true
  }
  if (hasSaveDir && typeof body.saveDir === 'string' && isUncSavePath(body.saveDir)) {
    sendSaveSlotJson(res, 400, { error: 'UNC paths are not allowed for saveDir' })
    return true
  }

  const nextSlot = hasSlot ? ((body.slot as string | null | undefined) ?? null) : null
  if (hasSaveDir) {
    setCustomSaveOverride((body.saveDir as string | null | undefined) ?? null, nextSlot)
  } else if (hasSlot) {
    setSelectedSaveSlot(nextSlot)
  }

  const state = await getSafeTelemetryState()
  if (sseClients.size > 0) {
    broadcastTelemetryStateToSse(state)
  }

  sendSaveSlotJson(res, 200, {
    ok: true,
    activeSaveDir: state.activeSaveDir ?? null,
    activeSaveSlot: state.activeSaveSlot ?? null,
    availableSaveSlots: state.availableSaveSlots ?? [],
  })
  return true
}

export function lichiiTelemetryPlugin(): Plugin {
  const registerMiddleware = (middlewares: {
    use: (
      route: string,
      fn: (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void,
    ) => void
  }) => {
    middlewares.use('/api/lichii/stream', (req, res, next) => {
      if (req.method && req.method !== 'GET') {
        next()
        return
      }
      handleLichiiStreamRequest(req, res)
    })

    middlewares.use('/api/sync/state', (req, res, next) => {
      void handleSyncApiRequest(req, res, '/api/sync/state')
        .then((handled) => {
          if (!handled) next()
        })
        .catch(() => {
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'Internal Server Error' }))
          }
        })
    })

    middlewares.use('/api/saves/slot', (req, res, next) => {
      void handleSaveSlotApiRequest(req, res, '/api/saves/slot')
        .then((handled) => {
          if (!handled) next()
        })
        .catch(() => {
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ error: 'Internal Server Error' }))
          }
        })
    })

    middlewares.use('/api/lichii/state', async (req, res, next) => {
      if (req.method && req.method !== 'GET') {
        next()
        return
      }
      const state = sanitizeTelemetryStateForRequest(await getSafeTelemetryState(), req)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
      res.end(JSON.stringify(state))
    })
  }

  return {
    name: 'lichii-telemetry',
    configureServer(server) {
      registerMiddleware(server.middlewares)
    },
    configurePreviewServer(server) {
      registerMiddleware(server.middlewares)
    },
  }
}
