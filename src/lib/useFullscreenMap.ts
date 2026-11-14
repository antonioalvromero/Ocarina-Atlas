import { useCallback, useEffect, useState, type RefObject } from 'react'

export type FullscreenElementLike = {
  requestFullscreen?: () => Promise<void> | void
  webkitRequestFullscreen?: () => Promise<void> | void
}

export type FullscreenDocumentLike = {
  fullscreenElement?: unknown
  webkitFullscreenElement?: unknown
  exitFullscreen?: () => Promise<void> | void
  webkitExitFullscreen?: () => Promise<void> | void
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

export function useFullscreenMap(targetRef: RefObject<HTMLElement | null>): FullscreenMapState {
  const [isMapOnly, setIsMapOnly] = useState(false)
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(() => Boolean(getFullscreenElement()))

  const isFullscreen = isMapOnly || isNativeFullscreen

  const enterFullscreen = useCallback(async () => {
    setIsMapOnly(true)
    const entered = await tryRequestFullscreen(targetRef.current as FullscreenElementLike | null)
    if (entered) {
      setIsNativeFullscreen(Boolean(getFullscreenElement()))
    }
    await tryLockLandscape()
  }, [targetRef])

  const exitFullscreen = useCallback(async () => {
    setIsMapOnly(false)
    await tryExitFullscreen()
    setIsNativeFullscreen(Boolean(getFullscreenElement()))
    tryUnlockOrientation()
  }, [])

  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await exitFullscreen()
    } else {
      await enterFullscreen()
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const syncNative = () => {
      const native = Boolean(getFullscreenElement())
      setIsNativeFullscreen(native)
      if (!native) {
        setIsMapOnly(false)
        tryUnlockOrientation()
      }
    }
    document.addEventListener('fullscreenchange', syncNative)
    document.addEventListener('webkitfullscreenchange', syncNative)
    return () => {
      document.removeEventListener('fullscreenchange', syncNative)
      document.removeEventListener('webkitfullscreenchange', syncNative)
    }
  }, [])

  useEffect(() => {
    if (!isMapOnly || isNativeFullscreen || typeof window === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void exitFullscreen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMapOnly, isNativeFullscreen, exitFullscreen])

  return {
    isFullscreen,
    isNativeFullscreen,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  }
}
