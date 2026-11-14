import { useCallback, useSyncExternalStore, type RefObject } from 'react'

export type FullscreenElementLike = {
  requestFullscreen?: () => Promise<void> | void
  webkitRequestFullscreen?: () => Promise<void> | void
}

export type FullscreenDocumentLike = {
  fullscreenElement?: unknown
  webkitFullscreenElement?: unknown
  exitFullscreen?: () => Promise<void> | void
  webkitExitFullscreen?: () => Promise<void> | void
  documentElement?: FullscreenElementLike | null
}

export type ScreenOrientationLike = {
  lock?: (orientation: string) => Promise<void> | void
  unlock?: () => void
}

export function getFullscreenElement(doc?: FullscreenDocumentLike | null): unknown {
  const target = doc ?? (typeof document !== 'undefined' ? (document as unknown as FullscreenDocumentLike) : null)
  if (!target) return null
  return target.fullscreenElement ?? target.webkitFullscreenElement ?? null
}

export function resolveFullscreenTarget(
  fallbackElement?: FullscreenElementLike | null,
  doc?: FullscreenDocumentLike | null,
): FullscreenElementLike | null {
  const targetDoc =
    doc !== undefined
      ? doc
      : typeof document !== 'undefined'
        ? (document as unknown as FullscreenDocumentLike)
        : null
  const root = targetDoc?.documentElement ?? null
  if (root && (typeof root.requestFullscreen === 'function' || typeof root.webkitRequestFullscreen === 'function')) {
    return root
  }
  return fallbackElement ?? root ?? null
}

export async function tryRequestFullscreen(element: FullscreenElementLike | null | undefined): Promise<boolean> {
  if (!element) return false
  const request = element.requestFullscreen ?? element.webkitRequestFullscreen
  if (typeof request !== 'function') return false
  try {
    await request.call(element)
    return true
  } catch {
    return false
  }
}

export async function tryExitFullscreen(doc?: FullscreenDocumentLike | null): Promise<boolean> {
  const target = doc ?? (typeof document !== 'undefined' ? (document as unknown as FullscreenDocumentLike) : null)
  if (!target || !getFullscreenElement(target)) return false
  const exit = target.exitFullscreen ?? target.webkitExitFullscreen
  if (typeof exit !== 'function') return false
  try {
    await exit.call(target)
    return true
  } catch {
    return false
  }
}

export async function tryLockLandscape(orientationObj?: ScreenOrientationLike | null): Promise<boolean> {
  const target =
    orientationObj ??
    (typeof screen !== 'undefined' ? (screen.orientation as unknown as ScreenOrientationLike | undefined) : null)
  if (!target || typeof target.lock !== 'function') return false
  try {
    await target.lock('landscape')
    return true
  } catch {
    return false
  }
}

export function tryUnlockOrientation(orientationObj?: ScreenOrientationLike | null): boolean {
  const target =
    orientationObj ??
    (typeof screen !== 'undefined' ? (screen.orientation as unknown as ScreenOrientationLike | undefined) : null)
  if (!target || typeof target.unlock !== 'function') return false
  try {
    target.unlock()
    return true
  } catch {
    return false
  }
}

export type FullscreenMapState = {
  isFullscreen: boolean
  isNativeFullscreen: boolean
  enterFullscreen: () => Promise<void>
  exitFullscreen: () => Promise<void>
  toggleFullscreen: () => Promise<void>
}

type FullscreenStoreSnapshot = {
  isMapOnly: boolean
  isNativeFullscreen: boolean
}

const MAP_ONLY_STORAGE_KEY = 'oot-map:v1:map-only'
const SERVER_SNAPSHOT: FullscreenStoreSnapshot = {
  isMapOnly: false,
  isNativeFullscreen: false,
}

let initialized = false
let snapshot: FullscreenStoreSnapshot = SERVER_SNAPSHOT
const listeners = new Set<() => void>()
let globalListenersAttached = false

function readStoredMapOnly(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage?.getItem(MAP_ONLY_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStoredMapOnly(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (value) {
      window.sessionStorage?.setItem(MAP_ONLY_STORAGE_KEY, '1')
    } else {
      window.sessionStorage?.removeItem(MAP_ONLY_STORAGE_KEY)
    }
  } catch {
    // Ignore storage quota or restricted-context errors
  }
}

function ensureInitialized(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  const isMapOnly = readStoredMapOnly()
  const isNativeFullscreen = Boolean(getFullscreenElement())
  if (isMapOnly !== snapshot.isMapOnly || isNativeFullscreen !== snapshot.isNativeFullscreen) {
    snapshot = { isMapOnly, isNativeFullscreen }
  }
}

function updateSnapshot(partial: Partial<FullscreenStoreSnapshot>): void {
  ensureInitialized()
  const nextMapOnly = partial.isMapOnly ?? snapshot.isMapOnly
  const nextNative = partial.isNativeFullscreen ?? snapshot.isNativeFullscreen
  if (nextMapOnly === snapshot.isMapOnly && nextNative === snapshot.isNativeFullscreen) {
    return
  }
  snapshot = {
    isMapOnly: nextMapOnly,
    isNativeFullscreen: nextNative,
  }
  if (partial.isMapOnly !== undefined) {
    writeStoredMapOnly(nextMapOnly)
  }
  for (const listener of listeners) {
    listener()
  }
}

function handleFullscreenChange(): void {
  const native = Boolean(getFullscreenElement())
  if (!native) {
    // Leaving native fullscreen (e.g. browser Escape or OS gesture) also exits map-only mode
    updateSnapshot({ isNativeFullscreen: false, isMapOnly: false })
    tryUnlockOrientation()
  } else {
    updateSnapshot({ isNativeFullscreen: true })
  }
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && snapshot.isMapOnly && !snapshot.isNativeFullscreen) {
    void exitFullscreen()
  }
}

function attachGlobalListeners(): void {
  if (globalListenersAttached) return
  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown)
  }
  globalListenersAttached = true
}

function detachGlobalListeners(): void {
  if (!globalListenersAttached) return
  if (typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', handleFullscreenChange)
    document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeyDown)
  }
  globalListenersAttached = false
}

function subscribeStore(listener: () => void): () => void {
  ensureInitialized()
  if (listeners.size === 0) {
    const native = Boolean(getFullscreenElement())
    if (snapshot.isNativeFullscreen && !native) {
      updateSnapshot({ isNativeFullscreen: false, isMapOnly: false })
    } else if (!snapshot.isNativeFullscreen && native) {
      updateSnapshot({ isNativeFullscreen: true })
    }
  }
  listeners.add(listener)
  attachGlobalListeners()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      detachGlobalListeners()
    }
  }
}

function getStoreSnapshot(): FullscreenStoreSnapshot {
  ensureInitialized()
  return snapshot
}

function getServerSnapshot(): FullscreenStoreSnapshot {
  return SERVER_SNAPSHOT
}

export async function enterFullscreen(fallbackElement?: FullscreenElementLike | null): Promise<void> {
  updateSnapshot({ isMapOnly: true })
  const target = resolveFullscreenTarget(fallbackElement)
  const entered = await tryRequestFullscreen(target)
  if (entered) {
    updateSnapshot({ isNativeFullscreen: Boolean(getFullscreenElement()) })
  }
  await tryLockLandscape()
}

export async function exitFullscreen(): Promise<void> {
  updateSnapshot({ isMapOnly: false })
  await tryExitFullscreen()
  updateSnapshot({ isNativeFullscreen: Boolean(getFullscreenElement()) })
  tryUnlockOrientation()
}

export function getFullscreenSnapshotForTests(): FullscreenStoreSnapshot & { isFullscreen: boolean } {
  const current = getStoreSnapshot()
  return {
    ...current,
    isFullscreen: current.isMapOnly || current.isNativeFullscreen,
  }
}

export function subscribeFullscreenStoreForTests(listener: () => void): () => void {
  return subscribeStore(listener)
}

export function resetFullscreenForTests(): void {
  detachGlobalListeners()
  listeners.clear()
  initialized = false
  snapshot = SERVER_SNAPSHOT
  writeStoredMapOnly(false)
}

export function useFullscreenMap(targetRef?: RefObject<HTMLElement | null>): FullscreenMapState {
  const { isMapOnly, isNativeFullscreen } = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getServerSnapshot,
  )

  const isFullscreen = isMapOnly || isNativeFullscreen

  const enter = useCallback(async () => {
    await enterFullscreen(targetRef?.current as FullscreenElementLike | null | undefined)
  }, [targetRef])

  const exit = useCallback(async () => {
    await exitFullscreen()
  }, [])

  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await exit()
    } else {
      await enter()
    }
  }, [isFullscreen, enter, exit])

  return {
    isFullscreen,
    isNativeFullscreen,
    enterFullscreen: enter,
    exitFullscreen: exit,
    toggleFullscreen,
  }
}
