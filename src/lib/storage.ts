import { useSyncExternalStore } from 'react'
import { OTHER_PIN } from './pinTypes'
import type { AgeFilter, Fraction } from './types'

const PREFIX = 'oot-map:v1:'

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

export const ageFilterSlot: Slot<AgeFilter> = {
  key: 'age-filter',
  empty: 'both',
  parse: (raw) => (raw === 'child' || raw === 'adult' ? raw : 'both'),
}

export function pinsSlot(placeId: string, mapId: string): Slot<CustomPin[]> {
  return { key: `pins:${placeId}:${mapId}`, empty: NO_PINS, parse: parsePins }
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

function notify() {
  for (const listener of listeners) listener()
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
  try {
    backend()?.setItem(PREFIX + slot.key, JSON.stringify(value))
  } catch {
    return
  }
  notify()
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
