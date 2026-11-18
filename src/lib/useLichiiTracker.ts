import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { dataset } from './data'
import type { LichiiTelemetryState } from './lichii-types'
import {
  applyRemoteSyncState,
  initRemoteSync,
  officialDoneSlot,
  officialRevealedSlot,
  ownedPrereqsSlot,
  prereqAutoSyncSlot,
  read,
  useStored,
  write,
  type Slot,
  type SyncStatePayload,
} from './storage'
import type { Item } from './types'

const gsItemIds = new Set(dataset.items.filter((item) => item.cat === 'gs').map((item) => item.id))
export const TRACKED_HEART_CONTAINER_IDS = new Set(
  dataset.items.filter((item) => item.cat === 'container').map((item) => item.id),
)
export const TRACKED_HEART_PIECE_IDS = new Set(
  dataset.items.filter((item) => item.cat === 'heart').map((item) => item.id),
)
export const TRACKED_BEAN_IDS = new Set(
  dataset.items.filter((item) => item.cat === 'bean').map((item) => item.id),
)
export const TRACKED_FAIRY_IDS = new Set(
  dataset.items.filter((item) => item.cat === 'fairy').map((item) => item.id),
)
export const TRACKED_BOTTLE_IDS = new Set(
  dataset.items.filter((item) => item.cat === 'bottle').map((item) => item.id),
)
export const TRACKED_THOUGHT_IDS = new Set(
  dataset.items.filter((item) => item.cat === 'thought').map((item) => item.id),
)
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

export type LichiiPositionState = {
  position: LichiiTelemetryState['position']
  mapFraction: LichiiTelemetryState['mapFraction']
  worldMapFraction: LichiiTelemetryState['worldMapFraction']
}

const INITIAL_POSITION: LichiiPositionState = {
  position: null,
  mapFraction: null,
  worldMapFraction: null,
}

let storeState: StoreState = {
  telemetry: INITIAL_TELEMETRY,
  toasts: [],
  lastError: null,
}
let metaStoreState: StoreState = storeState
let positionSnapshot: LichiiPositionState = INITIAL_POSITION

const SSE_RECONNECT_MS = 3000

const storeListeners = new Set<() => void>()
const metaListeners = new Set<() => void>()
const positionListeners = new Set<() => void>()
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollToken = 0
let pollInFlight = false
let pollingActive = false
let eventSource: EventSource | null = null
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null
type CategorySyncState = {
  hasAuthoritativeSync: boolean
  lastSignature: string | null
  lastAuthoritative: boolean | null
  lastExtraId: string | null
  lastCollectedIds: readonly string[] | null
  sessionAnnouncedIds: Set<string>
}

const EMPTY_IDS: readonly string[] = []

function sameStringArray(a: readonly string[] | null, b: readonly string[]): boolean {
  if (a === b) return true
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function sameOptionalStringArray(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return (a?.length ?? 0) === 0 && (b?.length ?? 0) === 0
  return sameStringArray(a, b)
}

function samePosition(
  a: LichiiTelemetryState['position'],
  b: LichiiTelemetryState['position'],
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw
}

function sameFraction(
  a: LichiiTelemetryState['mapFraction'],
  b: LichiiTelemetryState['mapFraction'],
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y
}

function hasPositionChanged(prev: LichiiPositionState, next: LichiiTelemetryState): boolean {
  return (
    !samePosition(prev.position, next.position) ||
    !sameFraction(prev.mapFraction, next.mapFraction) ||
    !sameFraction(prev.worldMapFraction, next.worldMapFraction)
  )
}

function hasMetaChanged(prev: StoreState, next: StoreState): boolean {
  if (prev.toasts !== next.toasts || prev.lastError !== next.lastError) return true
  const a = prev.telemetry
  const b = next.telemetry
  if (a === b) return false
  return (
    a.connected !== b.connected ||
    a.emulatorRunning !== b.emulatorRunning ||
    a.emulator !== b.emulator ||
    a.titleId !== b.titleId ||
    a.scene !== b.scene ||
    a.placeId !== b.placeId ||
    a.placeSlug !== b.placeSlug ||
    a.placeName !== b.placeName ||
    a.mapId !== b.mapId ||
    a.age !== b.age ||
    a.skulltulaCount !== b.skulltulaCount ||
    a.authoritativeSkulltulas !== b.authoritativeSkulltulas ||
    a.lastCollectedSkulltulaId !== b.lastCollectedSkulltulaId ||
    a.lastPickedItem !== b.lastPickedItem ||
    a.source !== b.source ||
    a.authoritativeHeartContainers !== b.authoritativeHeartContainers ||
    a.authoritativeHeartPieces !== b.authoritativeHeartPieces ||
    a.authoritativeBeans !== b.authoritativeBeans ||
    a.authoritativeFairies !== b.authoritativeFairies ||
    a.authoritativeBottles !== b.authoritativeBottles ||
    a.authoritativeThoughts !== b.authoritativeThoughts ||
    !sameStringArray(a.collectedSkulltulaIds, b.collectedSkulltulaIds) ||
    !sameOptionalStringArray(a.collectedHeartContainerIds, b.collectedHeartContainerIds) ||
    !sameOptionalStringArray(a.collectedHeartPieceIds, b.collectedHeartPieceIds) ||
    !sameOptionalStringArray(a.collectedBeanIds, b.collectedBeanIds) ||
    !sameOptionalStringArray(a.collectedFairyIds, b.collectedFairyIds) ||
    !sameOptionalStringArray(a.collectedBottleIds, b.collectedBottleIds) ||
    !sameOptionalStringArray(a.collectedThoughtIds, b.collectedThoughtIds) ||
    !sameOptionalStringArray(a.ownedRequirements, b.ownedRequirements)
  )
}

function createCategorySyncState(): CategorySyncState {
  return {
    hasAuthoritativeSync: false,
    lastSignature: null,
    lastAuthoritative: null,
    lastExtraId: null,
    lastCollectedIds: null,
    sessionAnnouncedIds: new Set<string>(),
  }
}

function resetCategorySyncState(state: CategorySyncState, clearAnnounced: boolean): void {
  state.hasAuthoritativeSync = false
  state.lastSignature = null
  state.lastAuthoritative = null
  state.lastExtraId = null
  state.lastCollectedIds = null
  if (clearAnnounced) {
    state.sessionAnnouncedIds.clear()
  }
}

let activeSubscribers = 0
let lastPrereqSyncSignature: string | null = null
const gsSyncState = createCategorySyncState()
const heartSyncState = createCategorySyncState()
const heartPieceSyncState = createCategorySyncState()
const beanSyncState = createCategorySyncState()
const fairySyncState = createCategorySyncState()
const bottleSyncState = createCategorySyncState()
const thoughtSyncState = createCategorySyncState()

function resetAllCategorySyncStates(clearAnnounced: boolean): void {
  resetCategorySyncState(gsSyncState, clearAnnounced)
  resetCategorySyncState(heartSyncState, clearAnnounced)
  resetCategorySyncState(heartPieceSyncState, clearAnnounced)
  resetCategorySyncState(beanSyncState, clearAnnounced)
  resetCategorySyncState(fairySyncState, clearAnnounced)
  resetCategorySyncState(bottleSyncState, clearAnnounced)
  resetCategorySyncState(thoughtSyncState, clearAnnounced)
}

function commitStoreState(next: StoreState) {
  storeState = next
  if (hasPositionChanged(positionSnapshot, next.telemetry)) {
    positionSnapshot = {
      position: next.telemetry.position,
      mapFraction: next.telemetry.mapFraction,
      worldMapFraction: next.telemetry.worldMapFraction,
    }
    for (const listener of positionListeners) listener()
  }
  if (hasMetaChanged(metaStoreState, next)) {
    metaStoreState = next
    for (const listener of metaListeners) listener()
  }
  for (const listener of storeListeners) listener()
}

export function isLiveMemoryState(state: LichiiTelemetryState): boolean {
  return Boolean(state.connected && state.emulatorRunning && state.source === 'memory')
}

export function canSyncTelemetryProgress(state: LichiiTelemetryState): boolean {
  return isLiveMemoryState(state) || state.source === 'save'
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
 * Items outside `TRACKED_HEART_CONTAINER_IDS` are never unmarked.
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

/**
 * Reconciles officialDoneSlot / officialRevealedSlot with tracked Piece of Heart IDs.
 * Items outside `TRACKED_HEART_PIECE_IDS` are never unmarked.
 */
export function reconcileHeartPieceLists(params: {
  doneList: string[]
  revealedList: string[]
  collectedIds: string[]
  authoritative: boolean
  validHeartPieceIds?: Set<string>
}): ReconcileResult {
  return reconcileItemLists({
    doneList: params.doneList,
    revealedList: params.revealedList,
    collectedIds: params.collectedIds,
    authoritative: params.authoritative,
    validIds: params.validHeartPieceIds ?? TRACKED_HEART_PIECE_IDS,
  })
}

/**
 * Reconciles officialDoneSlot / officialRevealedSlot with tracked Magic Bean IDs.
 * Items outside `TRACKED_BEAN_IDS` are never unmarked.
 */
export function reconcileBeanLists(params: {
  doneList: string[]
  revealedList: string[]
  collectedIds: string[]
  authoritative: boolean
  validBeanIds?: Set<string>
}): ReconcileResult {
  return reconcileItemLists({
    doneList: params.doneList,
    revealedList: params.revealedList,
    collectedIds: params.collectedIds,
    authoritative: params.authoritative,
    validIds: params.validBeanIds ?? TRACKED_BEAN_IDS,
  })
}

/**
 * Reconciles officialDoneSlot / officialRevealedSlot with tracked Great Fairy IDs.
 * Items outside `TRACKED_FAIRY_IDS` are never unmarked.
 */
export function reconcileFairyLists(params: {
  doneList: string[]
  revealedList: string[]
  collectedIds: string[]
  authoritative: boolean
  validFairyIds?: Set<string>
}): ReconcileResult {
  return reconcileItemLists({
    doneList: params.doneList,
    revealedList: params.revealedList,
    collectedIds: params.collectedIds,
    authoritative: params.authoritative,
    validIds: params.validFairyIds ?? TRACKED_FAIRY_IDS,
  })
}

/**
 * Reconciles officialDoneSlot / officialRevealedSlot with tracked Bottle IDs.
 * Items outside `TRACKED_BOTTLE_IDS` are never unmarked.
 */
export function reconcileBottleLists(params: {
  doneList: string[]
  revealedList: string[]
  collectedIds: string[]
  authoritative: boolean
  validBottleIds?: Set<string>
}): ReconcileResult {
  return reconcileItemLists({
    doneList: params.doneList,
    revealedList: params.revealedList,
    collectedIds: params.collectedIds,
    authoritative: params.authoritative,
    validIds: params.validBottleIds ?? TRACKED_BOTTLE_IDS,
  })
}

/**
 * Reconciles officialDoneSlot / officialRevealedSlot with tracked Fairy Thought IDs.
 * Items outside `TRACKED_THOUGHT_IDS` are never unmarked.
 */
export function reconcileThoughtLists(params: {
  doneList: string[]
  revealedList: string[]
  collectedIds: string[]
  authoritative: boolean
  validThoughtIds?: Set<string>
}): ReconcileResult {
  return reconcileItemLists({
    doneList: params.doneList,
    revealedList: params.revealedList,
    collectedIds: params.collectedIds,
    authoritative: params.authoritative,
    validIds: params.validThoughtIds ?? TRACKED_THOUGHT_IDS,
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
  if (!canSyncTelemetryProgress(next)) {
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
    isLiveMemoryState(next) &&
    wasSyncedBefore &&
    authoritative &&
    removedIds.length === 0 &&
    addedIds.length > 0 &&
    addedIds.length <= 2

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

function processTrackedCategory(params: {
  next: LichiiTelemetryState
  syncState: CategorySyncState
  enabled: boolean
  rawCollectedIds: readonly string[] | undefined
  extraId?: string | null
  authoritative: boolean
  validIds: Set<string>
  formatItemName: (item: Item) => string
  skulltulaCount: number | null
}): void {
  const {
    next,
    syncState,
    enabled,
    rawCollectedIds,
    extraId = null,
    authoritative,
    validIds,
    formatItemName,
    skulltulaCount,
  } = params

  if (!enabled) {
    resetCategorySyncState(syncState, false)
    return
  }

  const baseIds = rawCollectedIds ?? EMPTY_IDS
  if (
    syncState.lastCollectedIds !== null &&
    syncState.lastAuthoritative === authoritative &&
    syncState.lastExtraId === extraId &&
    sameStringArray(syncState.lastCollectedIds, baseIds)
  ) {
    return
  }

  syncState.lastCollectedIds = baseIds.slice()
  syncState.lastAuthoritative = authoritative
  syncState.lastExtraId = extraId

  const collectedIds = extraId ? [...baseIds, extraId] : (baseIds as string[])
  const signature = extraId
    ? `${authoritative ? 1 : 0}:${extraId}:${collectedIds.join(',')}`
    : `${authoritative ? 1 : 0}:${collectedIds.join(',')}`

  syncTrackedCategory({
    next,
    syncState,
    enabled,
    collectedIds,
    authoritative,
    signature,
    validIds,
    formatItemName,
    skulltulaCount,
  })
}

function processAutoSkulltulas(next: LichiiTelemetryState) {
  processTrackedCategory({
    next,
    syncState: gsSyncState,
    enabled: read(lichiiAutoSkulltulaSlot),
    rawCollectedIds: next.collectedSkulltulaIds,
    extraId: next.lastCollectedSkulltulaId || null,
    authoritative: Boolean(next.authoritativeSkulltulas),
    validIds: gsItemIds,
    formatItemName: (item) => item.name,
    skulltulaCount: next.skulltulaCount,
  })
}

function processAutoHeartContainers(next: LichiiTelemetryState) {
  const isAuthoritative = Boolean(next.authoritativeHeartContainers)
  processTrackedCategory({
    next,
    syncState: heartSyncState,
    enabled: isAuthoritative,
    rawCollectedIds: next.collectedHeartContainerIds,
    authoritative: isAuthoritative,
    validIds: TRACKED_HEART_CONTAINER_IDS,
    formatItemName: (item) => `Heart Container collected: ${item.name}`,
    skulltulaCount: null,
  })
}

function processAutoHeartPieces(next: LichiiTelemetryState) {
  const isAuthoritative = Boolean(next.authoritativeHeartPieces)
  processTrackedCategory({
    next,
    syncState: heartPieceSyncState,
    enabled: isAuthoritative,
    rawCollectedIds: next.collectedHeartPieceIds,
    authoritative: isAuthoritative,
    validIds: TRACKED_HEART_PIECE_IDS,
    formatItemName: (item) => `Piece of Heart collected: ${item.name}`,
    skulltulaCount: null,
  })
}

function processAutoBeans(next: LichiiTelemetryState) {
  const isAuthoritative = Boolean(next.authoritativeBeans)
  processTrackedCategory({
    next,
    syncState: beanSyncState,
    enabled: isAuthoritative,
    rawCollectedIds: next.collectedBeanIds,
    authoritative: isAuthoritative,
    validIds: TRACKED_BEAN_IDS,
    formatItemName: (item) => `Magic Bean planted: ${item.name}`,
    skulltulaCount: null,
  })
}

function processAutoFairies(next: LichiiTelemetryState) {
  const isAuthoritative = Boolean(next.authoritativeFairies)
  processTrackedCategory({
    next,
    syncState: fairySyncState,
    enabled: isAuthoritative,
    rawCollectedIds: next.collectedFairyIds,
    authoritative: isAuthoritative,
    validIds: TRACKED_FAIRY_IDS,
    formatItemName: (item) => `Great Fairy visited: ${item.name}`,
    skulltulaCount: null,
  })
}

function processAutoBottles(next: LichiiTelemetryState) {
  const isAuthoritative = Boolean(next.authoritativeBottles)
  processTrackedCategory({
    next,
    syncState: bottleSyncState,
    enabled: isAuthoritative,
    rawCollectedIds: next.collectedBottleIds,
    authoritative: isAuthoritative,
    validIds: TRACKED_BOTTLE_IDS,
    formatItemName: (item) => `Bottle collected: ${item.name}`,
    skulltulaCount: null,
  })
}

function processAutoThoughts(next: LichiiTelemetryState) {
  const isAuthoritative = Boolean(next.authoritativeThoughts)
  processTrackedCategory({
    next,
    syncState: thoughtSyncState,
    enabled: isAuthoritative,
    rawCollectedIds: next.collectedThoughtIds,
    authoritative: isAuthoritative,
    validIds: TRACKED_THOUGHT_IDS,
    formatItemName: (item) => `Fairy Thought read: ${item.name}`,
    skulltulaCount: null,
  })
}

export function mergeOwnedRequirements(
  currentOwned: readonly string[],
  detectedRequirements: readonly string[],
): { next: string[]; changed: boolean } {
  if (detectedRequirements.length === 0) {
    return { next: currentOwned as string[], changed: false }
  }
  const existing = new Set(currentOwned)
  const additions: string[] = []
  for (const key of detectedRequirements) {
    if (!existing.has(key)) {
      existing.add(key)
      additions.push(key)
    }
  }
  if (additions.length === 0) {
    return { next: currentOwned as string[], changed: false }
  }
  return { next: [...currentOwned, ...additions], changed: true }
}

function processAutoPrerequisites(next: LichiiTelemetryState): void {
  if (!canSyncTelemetryProgress(next) || !read(prereqAutoSyncSlot)) {
    lastPrereqSyncSignature = null
    return
  }
  const detected = next.ownedRequirements
  if (!detected) return
  const signature = detected.join(',')
  if (signature === lastPrereqSyncSignature) return
  lastPrereqSyncSignature = signature
  const { next: merged, changed } = mergeOwnedRequirements(read(ownedPrereqsSlot), detected)
  if (changed) {
    write(ownedPrereqsSlot, merged)
  }
}

export function applyTelemetryState(data: LichiiTelemetryState) {
  if (!canSyncTelemetryProgress(data)) {
    resetAllCategorySyncStates(true)
    lastPrereqSyncSignature = null
  } else {
    processAutoSkulltulas(data)
    processAutoHeartContainers(data)
    processAutoHeartPieces(data)
    processAutoBeans(data)
    processAutoFairies(data)
    processAutoBottles(data)
    processAutoThoughts(data)
    processAutoPrerequisites(data)
  }
  commitStoreState({
    ...storeState,
    telemetry: data,
    lastError: null,
  })
}

export function resetTrackerForTests() {
  resetAllCategorySyncStates(true)
  lastPrereqSyncSignature = null
  storeState = {
    telemetry: INITIAL_TELEMETRY,
    toasts: [],
    lastError: null,
  }
  metaStoreState = storeState
  positionSnapshot = INITIAL_POSITION
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
    resetAllCategorySyncStates(true)
    lastPrereqSyncSignature = null
    commitStoreState({
      ...storeState,
      telemetry: {
        ...INITIAL_TELEMETRY,
        collectedSkulltulaIds: [],
        updatedAt: Date.now(),
      },
      lastError: err instanceof Error ? err.message : 'Connection failed',
    })
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

function registerSubscriber(listeners: Set<() => void>, listener: () => void): () => void {
  listeners.add(listener)
  activeSubscribers += 1
  if (activeSubscribers === 1 && typeof window !== 'undefined') {
    void initRemoteSync()
    connectEventSource()
  }
  return () => {
    listeners.delete(listener)
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

function subscribeStore(listener: () => void): () => void {
  return registerSubscriber(storeListeners, listener)
}

function subscribeMeta(listener: () => void): () => void {
  return registerSubscriber(metaListeners, listener)
}

function subscribePosition(listener: () => void): () => void {
  return registerSubscriber(positionListeners, listener)
}

function getStoreSnapshot(): StoreState {
  return storeState
}

function getMetaSnapshot(): StoreState {
  return metaStoreState
}

export function getLichiiPositionSnapshot(): LichiiPositionState {
  return positionSnapshot
}

export function subscribeLichiiPosition(listener: () => void): () => void {
  return subscribePosition(listener)
}

function getServerPositionSnapshot(): LichiiPositionState {
  return INITIAL_POSITION
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
  commitStoreState({
    ...storeState,
    toasts: storeState.toasts.filter((t) => t.id !== toastId),
  })
}

export function useLichiiPosition(): LichiiPositionState {
  return useSyncExternalStore(subscribePosition, getLichiiPositionSnapshot, getServerPositionSnapshot)
}

export function useLichiiTracker(options?: { trackPosition?: boolean }) {
  const trackPosition = options?.trackPosition ?? true
  const snapshot = useSyncExternalStore(
    trackPosition ? subscribeStore : subscribeMeta,
    trackPosition ? getStoreSnapshot : getMetaSnapshot,
    getServerSnapshot,
  )
  const followPlayer = useStored(lichiiFollowSlot)
  const autoMarkSkulltulas = useStored(lichiiAutoSkulltulaSlot)
  const prereqAutoSync = useStored(prereqAutoSyncSlot)

  // Auto-dismiss toasts after 7 seconds
  useEffect(() => {
    if (snapshot.toasts.length === 0) return
    const timer = setTimeout(() => {
      const cutoff = Date.now() - 6500
      commitStoreState({
        ...storeState,
        toasts: storeState.toasts.filter((t) => t.timestamp > cutoff),
      })
    }, 7000)
    return () => clearTimeout(timer)
  }, [snapshot.toasts])

  const setFollowPlayer = useCallback((next: boolean) => write(lichiiFollowSlot, next), [])
  const toggleFollowPlayer = useCallback(() => write(lichiiFollowSlot, !followPlayer), [followPlayer])
  const setAutoMarkSkulltulas = useCallback((next: boolean) => write(lichiiAutoSkulltulaSlot, next), [])
  const toggleAutoMarkSkulltulas = useCallback(
    () => write(lichiiAutoSkulltulaSlot, !autoMarkSkulltulas),
    [autoMarkSkulltulas],
  )
  const setPrereqAutoSync = useCallback((next: boolean) => {
    write(prereqAutoSyncSlot, next)
    if (next) {
      lastPrereqSyncSignature = null
      processAutoPrerequisites(storeState.telemetry)
    }
  }, [])
  const togglePrereqAutoSync = useCallback(
    () => setPrereqAutoSync(!prereqAutoSync),
    [prereqAutoSync, setPrereqAutoSync],
  )
  const syncPrereqsFromGame = useCallback((): boolean => {
    const detected = storeState.telemetry.ownedRequirements
    if (!detected) return false
    const { next: merged, changed } = mergeOwnedRequirements(read(ownedPrereqsSlot), detected)
    if (changed) {
      write(ownedPrereqsSlot, merged)
    }
    return true
  }, [])

  return {
    state: snapshot.telemetry,
    toasts: snapshot.toasts,
    error: snapshot.lastError,
    lastError: snapshot.lastError,
    followPlayer,
    setFollowPlayer,
    toggleFollowPlayer,
    autoMarkSkulltulas,
    setAutoMarkSkulltulas,
    toggleAutoMarkSkulltulas,
    prereqAutoSync,
    setPrereqAutoSync,
    togglePrereqAutoSync,
    syncPrereqsFromGame,
    dismissToast: dismissSkulltulaToast,
    refresh: pollOnce,
  }
}
