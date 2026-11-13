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
let activeSubscribers = 0
let hasAuthoritativeSync = false
let lastAutoSyncSignature: string | null = null
const sessionAnnouncedIds = new Set<string>()

function emitStore() {
  for (const listener of storeListeners) listener()
}

export function isLiveMemoryState(state: LichiiTelemetryState): boolean {
  return Boolean(state.connected && state.emulatorRunning && state.source === 'memory')
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
}): {
  nextDone: string[]
  nextRevealed: string[]
  doneChanged: boolean
  revealedChanged: boolean
  addedIds: string[]
  removedIds: string[]
} {
  const validGs = params.validGsIds ?? gsItemIds
  const collectedSet = new Set(params.collectedIds.filter((id) => validGs.has(id)))

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
      if (validGs.has(id) && !collectedSet.has(id)) {
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

function processAutoSkulltulas(next: LichiiTelemetryState) {
  if (!isLiveMemoryState(next)) {
    hasAuthoritativeSync = false
    lastAutoSyncSignature = null
    sessionAnnouncedIds.clear()
    return
  }

  const autoMark = read(lichiiAutoSkulltulaSlot)
  if (!autoMark) {
    hasAuthoritativeSync = false
    lastAutoSyncSignature = null
    return
  }

  const collectedIds = [...(next.collectedSkulltulaIds ?? [])]
  if (next.lastCollectedSkulltulaId) {
    collectedIds.push(next.lastCollectedSkulltulaId)
  }

  const isAuthoritative = Boolean(next.authoritativeSkulltulas)
  const signature = `${isAuthoritative ? 1 : 0}:${next.lastCollectedSkulltulaId ?? ''}:${collectedIds.join(',')}`
  if (signature === lastAutoSyncSignature) {
    return
  }
  lastAutoSyncSignature = signature

  const wasSyncedBefore = hasAuthoritativeSync
  const { nextDone, nextRevealed, doneChanged, revealedChanged, addedIds, removedIds } =
    reconcileSkulltulaLists({
      doneList: read(officialDoneSlot),
      revealedList: read(officialRevealedSlot),
      collectedIds,
      authoritative: isAuthoritative,
    })

  if (doneChanged) write(officialDoneSlot, nextDone)
  if (revealedChanged) write(officialRevealedSlot, nextRevealed)

  for (const id of removedIds) {
    sessionAnnouncedIds.delete(id)
  }

  const isIncrementalPickup =
    wasSyncedBefore && isAuthoritative && removedIds.length === 0 && addedIds.length > 0 && addedIds.length <= 2

  const newlyMarkedItems: Item[] = []
  for (const id of addedIds) {
    if (isIncrementalPickup && !sessionAnnouncedIds.has(id)) {
      const item = itemsById.get(id)
      if (item) newlyMarkedItems.push(item)
    }
    sessionAnnouncedIds.add(id)
  }

  if (isAuthoritative) {
    hasAuthoritativeSync = true
  }

  if (newlyMarkedItems.length > 0) {
    const now = Date.now()
    const newToasts: SkulltulaToast[] = newlyMarkedItems.map((item) => {
      const place = placesById.get(item.place)
      return {
        id: `${item.id}-${now}`,
        itemId: item.id,
        itemName: item.name,
        placeName: place?.name ?? next.placeName ?? 'Hyrule',
        skulltulaCount: next.skulltulaCount,
        timestamp: now,
      }
    })
    storeState = {
      ...storeState,
      toasts: [...newToasts, ...storeState.toasts].slice(0, 5),
    }
  }
}

function applyTelemetryState(data: LichiiTelemetryState) {
  processAutoSkulltulas(data)
  storeState = {
    ...storeState,
    telemetry: data,
    lastError: null,
  }
  emitStore()
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
    hasAuthoritativeSync = false
    lastAutoSyncSignature = null
    sessionAnnouncedIds.clear()
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
