import { useEffect, useSyncExternalStore } from 'react'
import { dataset } from './data'
import type { LichiiTelemetryState } from './lichii-types'
import {
  applyRemoteSyncState,
  initRemoteSync,
  officialDoneSlot,
  officialRevealedSlot,
  read,
  useStored,
  write,
  type Slot,
  type SyncStatePayload,
} from './storage'
import type { Item } from './types'

const gsItemIds = new Set(dataset.items.filter((item) => item.cat === 'gs').map((item) => item.id))
export const TRACKED_HEART_CONTAINER_IDS = new Set(['espiritu-heart-01'])
const itemsById = new Map(dataset.items.map((item) => [item.id, item]))
const placesById = new Map(dataset.places.map((p) => [p.id, p]))

export const lichiiFollowSlot: Slot<boolean> = {
  key: 'lichii-follow',
  empty: true,
  parse: (raw) => (typeof raw === 'boolean' ? raw : true),
}

export const lichiiAutoSkulltulaSlot: Slot<boolean> = {
  key: 'lichii-auto-skulltula',
  empty: true,
  parse: (raw) => (typeof raw === 'boolean' ? raw : true),
}

export type SkulltulaToast = {
  id: string
  itemId: string
  itemName: string
  placeName: string
  skulltulaCount: number | null
  timestamp: number
}

const INITIAL_TELEMETRY: LichiiTelemetryState = {
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
  source: 'none',
  updatedAt: 0,
}

type StoreState = {
  telemetry: LichiiTelemetryState
  toasts: SkulltulaToast[]
  lastError: string | null
}

let storeState: StoreState = {
  telemetry: INITIAL_TELEMETRY,
  toasts: [],
  lastError: null,
}

const SSE_RECONNECT_MS = 3000

const storeListeners = new Set<() => void>()
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollToken = 0
let pollInFlight = false
let pollingActive = false
let eventSource: EventSource | null = null
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null
type CategorySyncState = {
  hasAuthoritativeSync: boolean
  lastSignature: string | null
  sessionAnnouncedIds: Set<string>
}

function createCategorySyncState(): CategorySyncState {
  return {
    hasAuthoritativeSync: false,
    lastSignature: null,
    sessionAnnouncedIds: new Set<string>(),
  }
}

function resetCategorySyncState(state: CategorySyncState, clearAnnounced: boolean): void {
  state.hasAuthoritativeSync = false
  state.lastSignature = null
  if (clearAnnounced) {
    state.sessionAnnouncedIds.clear()
  }
}

let activeSubscribers = 0
const gsSyncState = createCategorySyncState()
const heartSyncState = createCategorySyncState()

function emitStore() {
  for (const listener of storeListeners) listener()
}

export function isLiveMemoryState(state: LichiiTelemetryState): boolean {
  return Boolean(state.connected && state.emulatorRunning && state.source === 'memory')
}

export type ReconcileResult = {
  nextDone: string[]
  nextRevealed: string[]
  doneChanged: boolean
  revealedChanged: boolean
  addedIds: string[]
  removedIds: string[]
}

/**
 * Reconciles officialDoneSlot / officialRevealedSlot with active collected IDs within `validIds`.
 * Adds collected IDs and, when `authoritative` is true, unmarks IDs in `validIds` absent from `collectedIds`.
 */
export function reconcileItemLists(params: {
  doneList: string[]
  revealedList: string[]
  collectedIds: string[]
  authoritative: boolean
  validIds: Set<string>
}): ReconcileResult {
  const { validIds } = params
  const collectedSet = new Set(params.collectedIds.filter((id) => validIds.has(id)))

  let nextDone = [...params.doneList]
  const doneSet = new Set(nextDone)
  let nextRevealed = [...params.revealedList]
  const revealedSet = new Set(nextRevealed)
  const addedIds: string[] = []
  const removedIds: string[] = []

  for (const id of collectedSet) {
    if (!doneSet.has(id)) {
      doneSet.add(id)
      nextDone.push(id)
      addedIds.push(id)
    }
    if (!revealedSet.has(id)) {
      revealedSet.add(id)
      nextRevealed.push(id)
    }
  }

  if (params.authoritative) {
    const removedSet = new Set<string>()
    for (const id of nextDone) {
      if (validIds.has(id) && !collectedSet.has(id)) {
        removedSet.add(id)
        removedIds.push(id)
      }
    }
    if (removedSet.size > 0) {
      nextDone = nextDone.filter((id) => !removedSet.has(id))
      nextRevealed = nextRevealed.filter((id) => !removedSet.has(id))
    }
  }

  const revealedChanged =
    nextRevealed.length !== params.revealedList.length ||
    nextRevealed.some((id, idx) => id !== params.revealedList[idx])

  return {
    nextDone,
    nextRevealed,
    doneChanged: addedIds.length > 0 || removedIds.length > 0,
    revealedChanged,
    addedIds,
    removedIds,
  }
}

/**
 * Reconciles officialDoneSlot / officialRevealedSlot with active collected GS IDs.
 * Adds collected IDs and, when `authoritative` is true, unmarks GS IDs absent from the loaded save.
 */
export function reconcileSkulltulaLists(params: {
  doneList: string[]
  revealedList: string[]
  collectedIds: string[]
  authoritative: boolean
  validGsIds?: Set<string>
}): ReconcileResult {
  return reconcileItemLists({
    doneList: params.doneList,
    revealedList: params.revealedList,
    collectedIds: params.collectedIds,
    authoritative: params.authoritative,
    validIds: params.validGsIds ?? gsItemIds,
  })
}

/**
 * Reconciles officialDoneSlot / officialRevealedSlot with tracked Heart Container IDs.
 * Unmapped Heart Containers outside `TRACKED_HEART_CONTAINER_IDS` are never unmarked.
 */
export function reconcileHeartContainerLists(params: {
  doneList: string[]
  revealedList: string[]
  collectedIds: string[]
  authoritative: boolean
  validHeartIds?: Set<string>
}): ReconcileResult {
  return reconcileItemLists({
    doneList: params.doneList,
    revealedList: params.revealedList,
    collectedIds: params.collectedIds,
    authoritative: params.authoritative,
    validIds: params.validHeartIds ?? TRACKED_HEART_CONTAINER_IDS,
  })
}

function syncTrackedCategory(params: {
  next: LichiiTelemetryState
  syncState: CategorySyncState
  enabled: boolean
  collectedIds: string[]
  authoritative: boolean
  signature: string
  validIds: Set<string>
  formatItemName: (item: Item) => string
  skulltulaCount: number | null
}): void {
  const { next, syncState, enabled, collectedIds, authoritative, signature, validIds } = params
  if (!isLiveMemoryState(next)) {
    resetCategorySyncState(syncState, true)
    return
  }

  if (!enabled) {
    resetCategorySyncState(syncState, false)
    return
  }

  if (signature === syncState.lastSignature) {
    return
  }
  syncState.lastSignature = signature

  const wasSyncedBefore = syncState.hasAuthoritativeSync
  const { nextDone, nextRevealed, doneChanged, revealedChanged, addedIds, removedIds } =
    reconcileItemLists({
      doneList: read(officialDoneSlot),
      revealedList: read(officialRevealedSlot),
      collectedIds,
      authoritative,
      validIds,
    })

  if (doneChanged) write(officialDoneSlot, nextDone)
  if (revealedChanged) write(officialRevealedSlot, nextRevealed)

  for (const id of removedIds) {
    syncState.sessionAnnouncedIds.delete(id)
  }

  const isIncrementalPickup =
    wasSyncedBefore && authoritative && removedIds.length === 0 && addedIds.length > 0 && addedIds.length <= 2

  const newlyMarkedItems: Item[] = []
  for (const id of addedIds) {
    if (isIncrementalPickup && !syncState.sessionAnnouncedIds.has(id)) {
      const item = itemsById.get(id)
      if (item) newlyMarkedItems.push(item)
    }
    syncState.sessionAnnouncedIds.add(id)
  }

  if (authoritative) {
    syncState.hasAuthoritativeSync = true
  }

  if (newlyMarkedItems.length > 0) {
    const now = Date.now()
    const newToasts: SkulltulaToast[] = newlyMarkedItems.map((item) => {
      const place = placesById.get(item.place)
      return {
        id: `${item.id}-${now}`,
        itemId: item.id,
        itemName: params.formatItemName(item),
        placeName: place?.name ?? next.placeName ?? 'Hyrule',
        skulltulaCount: params.skulltulaCount,
        timestamp: now,
      }
    })
    storeState = {
      ...storeState,
      toasts: [...newToasts, ...storeState.toasts].slice(0, 5),
    }
  }
}

function processAutoSkulltulas(next: LichiiTelemetryState) {
  const collectedIds = [...(next.collectedSkulltulaIds ?? [])]
  if (next.lastCollectedSkulltulaId) {
    collectedIds.push(next.lastCollectedSkulltulaId)
  }
  const isAuthoritative = Boolean(next.authoritativeSkulltulas)
  const signature = `${isAuthoritative ? 1 : 0}:${next.lastCollectedSkulltulaId ?? ''}:${collectedIds.join(',')}`

  syncTrackedCategory({
    next,
    syncState: gsSyncState,
    enabled: read(lichiiAutoSkulltulaSlot),
    collectedIds,
    authoritative: isAuthoritative,
    signature,
    validIds: gsItemIds,
    formatItemName: (item) => item.name,
    skulltulaCount: next.skulltulaCount,
  })
}

function processAutoHeartContainers(next: LichiiTelemetryState) {
  const collectedIds = next.collectedHeartContainerIds ?? []
  const isAuthoritative = Boolean(next.authoritativeHeartContainers)
  const signature = `${isAuthoritative ? 1 : 0}:${collectedIds.join(',')}`

  syncTrackedCategory({
    next,
    syncState: heartSyncState,
    enabled: isAuthoritative,
    collectedIds,
    authoritative: isAuthoritative,
    signature,
    validIds: TRACKED_HEART_CONTAINER_IDS,
    formatItemName: (item) => `Heart Container collected: ${item.name}`,
    skulltulaCount: null,
  })
}

export function applyTelemetryState(data: LichiiTelemetryState) {
  processAutoSkulltulas(data)
  processAutoHeartContainers(data)
  storeState = {
    ...storeState,
    telemetry: data,
    lastError: null,
  }
  emitStore()
}

export function resetTrackerForTests() {
  resetCategorySyncState(gsSyncState, true)
  resetCategorySyncState(heartSyncState, true)
  storeState = {
    telemetry: INITIAL_TELEMETRY,
    toasts: [],
    lastError: null,
  }
}

export function getTrackerSnapshotForTests(): StoreState {
  return storeState
}

async function pollOnce() {
  if (typeof window === 'undefined' || pollInFlight) return
  pollInFlight = true
  try {
    const controller = new AbortController()
    const abortId = setTimeout(() => controller.abort(), 3000)
    let response: Response
    try {
      response = await fetch('/api/lichii/state', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(abortId)
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const data = (await response.json()) as LichiiTelemetryState
    applyTelemetryState(data)
  } catch (err) {
    resetCategorySyncState(gsSyncState, true)
    resetCategorySyncState(heartSyncState, true)
    storeState = {
      ...storeState,
      telemetry: {
        ...INITIAL_TELEMETRY,
        collectedSkulltulaIds: [],
        updatedAt: Date.now(),
      },
      lastError: err instanceof Error ? err.message : 'Connection failed',
    }
    emitStore()
  } finally {
    pollInFlight = false
  }
}

function scheduleNextPoll(token: number) {
  if (!pollingActive || activeSubscribers === 0 || token !== pollToken) return
  const delayMs = isLiveMemoryState(storeState.telemetry) ? 150 : 750
  pollTimer = setTimeout(() => {
    pollTimer = null
    if (!pollingActive || activeSubscribers === 0 || token !== pollToken) return
    void pollOnce().finally(() => {
      scheduleNextPoll(token)
    })
  }, delayMs)
}

function startFallbackPolling() {
  if (pollingActive || activeSubscribers === 0 || typeof window === 'undefined') return
  pollingActive = true
  const token = ++pollToken
  void pollOnce().finally(() => {
    if (pollingActive) scheduleNextPoll(token)
  })
}

function stopPolling() {
  pollingActive = false
  pollToken += 1
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function closeEventSource() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

function connectEventSource() {
  if (activeSubscribers === 0 || typeof window === 'undefined') return
  if (typeof EventSource === 'undefined') {
    startFallbackPolling()
    return
  }
  closeEventSource()
  if (sseReconnectTimer !== null) {
    clearTimeout(sseReconnectTimer)
    sseReconnectTimer = null
  }

  const es = new EventSource('/api/lichii/stream')
  eventSource = es

  es.addEventListener('open', () => {
    if (eventSource !== es) return
    stopPolling()
  })

  es.addEventListener('telemetry', (event) => {
    if (eventSource !== es) return
    stopPolling()
    try {
      const data = JSON.parse((event as MessageEvent<string>).data) as LichiiTelemetryState
      applyTelemetryState(data)
    } catch {
      // Ignore malformed SSE telemetry frame
    }
  })

  es.addEventListener('sync', (event) => {
    if (eventSource !== es) return
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SyncStatePayload
      applyRemoteSyncState(payload)
    } catch {
      // Ignore malformed SSE sync frame
    }
  })

  es.addEventListener('error', () => {
    if (eventSource !== es) return
    closeEventSource()
    startFallbackPolling()
    if (activeSubscribers > 0 && sseReconnectTimer === null) {
      sseReconnectTimer = setTimeout(() => {
        sseReconnectTimer = null
        connectEventSource()
      }, SSE_RECONNECT_MS)
    }
  })
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener)
  activeSubscribers += 1
  if (activeSubscribers === 1 && typeof window !== 'undefined') {
    void initRemoteSync()
    connectEventSource()
  }
  return () => {
    storeListeners.delete(listener)
    activeSubscribers = Math.max(0, activeSubscribers - 1)
    if (activeSubscribers === 0) {
      stopPolling()
      closeEventSource()
      if (sseReconnectTimer !== null) {
        clearTimeout(sseReconnectTimer)
        sseReconnectTimer = null
      }
    }
  }
}

function getStoreSnapshot(): StoreState {
  return storeState
}

const SERVER_SNAPSHOT: StoreState = {
  telemetry: INITIAL_TELEMETRY,
  toasts: [],
  lastError: null,
}

function getServerSnapshot(): StoreState {
  return SERVER_SNAPSHOT
}

export function dismissSkulltulaToast(toastId: string): void {
  storeState = {
    ...storeState,
    toasts: storeState.toasts.filter((t) => t.id !== toastId),
  }
  emitStore()
}

export function useLichiiTracker() {
  const snapshot = useSyncExternalStore(subscribeStore, getStoreSnapshot, getServerSnapshot)
  const followPlayer = useStored(lichiiFollowSlot)
  const autoMarkSkulltulas = useStored(lichiiAutoSkulltulaSlot)

  // Auto-dismiss toasts after 7 seconds
  useEffect(() => {
    if (snapshot.toasts.length === 0) return
    const timer = setTimeout(() => {
      const cutoff = Date.now() - 6500
      storeState = {
        ...storeState,
        toasts: storeState.toasts.filter((t) => t.timestamp > cutoff),
      }
      emitStore()
    }, 7000)
    return () => clearTimeout(timer)
  }, [snapshot.toasts])

  return {
    state: snapshot.telemetry,
    toasts: snapshot.toasts,
    error: snapshot.lastError,
    lastError: snapshot.lastError,
    followPlayer,
    setFollowPlayer: (next: boolean) => write(lichiiFollowSlot, next),
    toggleFollowPlayer: () => write(lichiiFollowSlot, !followPlayer),
    autoMarkSkulltulas,
    setAutoMarkSkulltulas: (next: boolean) => write(lichiiAutoSkulltulaSlot, next),
    toggleAutoMarkSkulltulas: () => write(lichiiAutoSkulltulaSlot, !autoMarkSkulltulas),
    dismissToast: dismissSkulltulaToast,
    refresh: pollOnce,
  }
}
