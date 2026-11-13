import { useSyncExternalStore } from 'react'
import { INITIAL_VIEW, MAX_ZOOM, MIN_ZOOM, type View } from './coords'
import { OTHER_PIN } from './pinTypes'
import type { AgeFilter, Fraction } from './types'

const PREFIX = 'oot-map:v1:'
const SYNC_DEBOUNCE_MS = 150
const SYNCABLE_EXACT_KEYS = new Set([
  'official-visible',
  'official-done',
  'official-revealed',
  'hidden-categories',
  'item-count-visible',
  'age-filter',
  'age',
])

export type SyncStatePayload = {
  version: number
  updatedAt?: number
  entries: Record<string, string>
}

export function isSyncableKey(key: string): boolean {
  const raw = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key
  return SYNCABLE_EXACT_KEYS.has(raw) || raw.startsWith('pins:')
}

function toFullKey(key: string): string {
  return key.startsWith(PREFIX) ? key : PREFIX + key
}

export type CustomPin = Fraction & { id: string; name: string; done: boolean; type: string }

export type Slot<T> = {
  key: string
  /** Value on the server, during hydration, and when nothing is stored. */
  empty: T
  parse: (raw: unknown) => T
}

const NO_STRINGS: string[] = []
const NO_PINS: CustomPin[] = []

function parseStrings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : NO_STRINGS
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value <= 1
}

function parseView(raw: unknown): View {
  if (typeof raw !== 'object' || raw === null) return INITIAL_VIEW
  const { cx, cy, zoom } = raw as Partial<View>
  const validZoom = typeof zoom === 'number' && zoom >= MIN_ZOOM && zoom <= MAX_ZOOM
  return isCoordinate(cx) && isCoordinate(cy) && validZoom ? { cx, cy, zoom } : INITIAL_VIEW
}

function isPin(raw: unknown): raw is Omit<CustomPin, 'type'> & { type?: unknown } {
  if (typeof raw !== 'object' || raw === null) return false
  const pin = raw as Partial<CustomPin>
  return (
    typeof pin.id === 'string' &&
    typeof pin.name === 'string' &&
    typeof pin.done === 'boolean' &&
    isCoordinate(pin.x) &&
    isCoordinate(pin.y)
  )
}

function parsePins(raw: unknown): CustomPin[] {
  if (!Array.isArray(raw)) return NO_PINS
  // Pins saved before types existed have none.
  return raw.filter(isPin).map((pin) => ({ ...pin, type: typeof pin.type === 'string' ? pin.type : OTHER_PIN }))
}

export const officialVisibleSlot: Slot<boolean> = {
  key: 'official-visible',
  empty: false,
  parse: (raw) => raw === true,
}

export const officialDoneSlot: Slot<string[]> = {
  key: 'official-done',
  empty: NO_STRINGS,
  parse: parseStrings,
}

/** Official items shown one by one, because a pin merged into them. */
export const officialRevealedSlot: Slot<string[]> = {
  key: 'official-revealed',
  empty: NO_STRINGS,
  parse: parseStrings,
}

export const hiddenCategoriesSlot: Slot<string[]> = {
  key: 'hidden-categories',
  empty: NO_STRINGS,
  parse: parseStrings,
}

/** Places whose item count the user chose to see. Hidden everywhere else. */
export const itemCountVisibleSlot: Slot<string[]> = {
  key: 'item-count-visible',
  empty: NO_STRINGS,
  parse: parseStrings,
}

export const ageFilterSlot: Slot<AgeFilter> = {
  key: 'age-filter',
  empty: 'both',
  parse: (raw) => (raw === 'child' || raw === 'adult' ? raw : 'both'),
}

export function pinsSlot(placeId: string, mapId: string): Slot<CustomPin[]> {
  return { key: `pins:${placeId}:${mapId}`, empty: NO_PINS, parse: parsePins }
}

/** Zoom and position of one map, so each map reopens where it was left. */
export function viewSlot(viewId: string): Slot<View> {
  return { key: `view:${viewId}`, empty: INITIAL_VIEW, parse: parseView }
}

function backend(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Keeps snapshots referentially stable until the stored text changes. */
const snapshots = new Map<string, { text: string; value: unknown }>()
const listeners = new Set<() => void>()

let applyingRemote = false
let lastSyncedVersion = 0
let syncInitPromise: Promise<void> | null = null
let syncPutTimer: ReturnType<typeof setTimeout> | null = null
const pendingSyncEntries = new Map<string, string>()

function notify() {
  for (const listener of listeners) listener()
}

function collectLocalSyncEntries(): Record<string, string> {
  const storage = backend()
  if (!storage) return {}
  const collected: Record<string, string> = {}
  if (typeof storage.length === 'number' && typeof storage.key === 'function') {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key || !key.startsWith(PREFIX) || !isSyncableKey(key)) continue
      const val = storage.getItem(key)
      if (typeof val === 'string') collected[key] = val
    }
    return collected
  }
  for (const key of SYNCABLE_EXACT_KEYS) {
    const fullKey = PREFIX + key
    const val = storage.getItem(fullKey)
    if (typeof val === 'string') collected[fullKey] = val
  }
  return collected
}

async function pushSyncEntries(entries: Record<string, string>): Promise<void> {
  if (Object.keys(entries).length === 0 || typeof fetch !== 'function') return
  try {
    const res = await fetch('/api/sync/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    })
    if (!res.ok) return
    const data = (await res.json()) as Partial<SyncStatePayload>
    if (typeof data?.version === 'number' && data.version > lastSyncedVersion) {
      lastSyncedVersion = data.version
    }
  } catch {
    // Offline or unreachable server; local storage remains intact.
  }
}

function scheduleSyncPut(fullKey: string, serialized: string): void {
  if (typeof window === 'undefined' || applyingRemote || typeof fetch !== 'function') return
  pendingSyncEntries.set(fullKey, serialized)
  if (syncPutTimer !== null) clearTimeout(syncPutTimer)
  syncPutTimer = setTimeout(() => {
    syncPutTimer = null
    const entries = Object.fromEntries(pendingSyncEntries)
    pendingSyncEntries.clear()
    void pushSyncEntries(entries)
  }, SYNC_DEBOUNCE_MS)
}

export function applyRemoteSyncState(payload: SyncStatePayload): boolean {
  if (!payload || typeof payload !== 'object' || typeof payload.entries !== 'object' || payload.entries === null) {
    return false
  }
  if (typeof payload.version === 'number' && payload.version <= lastSyncedVersion) {
    return false
  }
  const storage = backend()
  if (!storage) return false

  applyingRemote = true
  let changed = false
  try {
    for (const [rawKey, value] of Object.entries(payload.entries)) {
      if (typeof value !== 'string') continue
      const fullKey = toFullKey(rawKey)
      if (!isSyncableKey(fullKey)) continue
      if (storage.getItem(fullKey) !== value) {
        try {
          storage.setItem(fullKey, value)
          changed = true
        } catch {
          // Ignore storage quota errors on remote sync.
        }
      }
    }
    if (typeof payload.version === 'number') {
      lastSyncedVersion = Math.max(lastSyncedVersion, payload.version)
    }
  } finally {
    applyingRemote = false
  }

  if (changed) notify()
  return changed
}

export function initRemoteSync(): Promise<void> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return Promise.resolve()
  if (syncInitPromise) return syncInitPromise

  syncInitPromise = (async () => {
    try {
      const res = await fetch('/api/sync/state', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = (await res.json()) as SyncStatePayload
      const serverEntries: Record<string, string> = {}
      for (const [k, v] of Object.entries(data?.entries ?? {})) {
        const fullKey = toFullKey(k)
        if (isSyncableKey(fullKey) && typeof v === 'string') {
          serverEntries[fullKey] = v
        }
      }
      const localEntries = collectLocalSyncEntries()
      if (Object.keys(serverEntries).length > 0) {
        applyRemoteSyncState({
          version: typeof data?.version === 'number' ? data.version : 1,
          updatedAt: data?.updatedAt,
          entries: serverEntries,
        })
        const localOnly: Record<string, string> = {}
        for (const [k, v] of Object.entries(localEntries)) {
          if (!(k in serverEntries)) localOnly[k] = v
        }
        if (Object.keys(localOnly).length > 0) {
          await pushSyncEntries(localOnly)
        }
      } else if (Object.keys(localEntries).length > 0) {
        await pushSyncEntries(localEntries)
      }
    } catch {
      // Offline or unreachable server; fall back to localStorage only.
    }
  })()

  return syncInitPromise
}

export function resetSyncForTests(): void {
  if (syncPutTimer !== null) {
    clearTimeout(syncPutTimer)
    syncPutTimer = null
  }
  pendingSyncEntries.clear()
  applyingRemote = false
  lastSyncedVersion = 0
  syncInitPromise = null
}

export function read<T>(slot: Slot<T>): T {
  const text = backend()?.getItem(PREFIX + slot.key) ?? null
  if (text === null) return slot.empty
  const snapshot = snapshots.get(slot.key)
  if (snapshot?.text === text) return snapshot.value as T
  let value = slot.empty
  try {
    value = slot.parse(JSON.parse(text))
  } catch {
    // Corrupt entries read as empty and are replaced by the next write.
  }
  snapshots.set(slot.key, { text, value })
  return value
}

export function write<T>(slot: Slot<T>, value: T): void {
  const serialized = JSON.stringify(value)
  try {
    backend()?.setItem(PREFIX + slot.key, serialized)
  } catch {
    return
  }
  notify()
  if (isSyncableKey(slot.key)) {
    scheduleSyncPut(PREFIX + slot.key, serialized)
  }
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', notify)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', notify)
  }
}

/** Renders `slot.empty` on the server and at hydration, then the stored value. */
export function useStored<T>(slot: Slot<T>): T {
  return useSyncExternalStore(
    subscribe,
    () => read(slot),
    () => slot.empty,
  )
}

export function addPin(
  placeId: string,
  mapId: string,
  name: string,
  at: Fraction,
  type: string = OTHER_PIN,
): CustomPin {
  const slot = pinsSlot(placeId, mapId)
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const pin: CustomPin = { id, name, type, x: at.x, y: at.y, done: false }
  write(slot, [...read(slot), pin])
  return pin
}

export function updatePin(
  placeId: string,
  mapId: string,
  id: string,
  patch: Partial<Pick<CustomPin, 'name' | 'done' | 'type'>>,
): void {
  const slot = pinsSlot(placeId, mapId)
  write(
    slot,
    read(slot).map((pin) => (pin.id === id ? { ...pin, ...patch } : pin)),
  )
}

export function removePin(placeId: string, mapId: string, id: string): void {
  const slot = pinsSlot(placeId, mapId)
  write(
    slot,
    read(slot).filter((pin) => pin.id !== id),
  )
}

export function setInList(slot: Slot<string[]>, value: string, present: boolean): void {
  const others = read(slot).filter((v) => v !== value)
  write(slot, present ? [...others, value] : others)
}

export function toggleInList(slot: Slot<string[]>, value: string): void {
  setInList(slot, value, !read(slot).includes(value))
}
