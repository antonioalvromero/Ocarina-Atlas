import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  enterFullscreen,
  exitFullscreen,
  getFullscreenElement,
  getFullscreenSnapshotForTests,
  resetFullscreenForTests,
  resolveFullscreenTarget,
  subscribeFullscreenStoreForTests,
  tryExitFullscreen,
  tryLockLandscape,
  tryRequestFullscreen,
  tryUnlockOrientation,
} from './useFullscreenMap'

type ListenerMap = Map<string, Set<(event?: unknown) => void>>

function createFakeDom() {
  const docListeners: ListenerMap = new Map()
  const winListeners: ListenerMap = new Map()
  const sessionEntries = new Map<string, string>()

  const add = (map: ListenerMap, type: string, fn: (event?: unknown) => void) => {
    let set = map.get(type)
    if (!set) {
      set = new Set()
      map.set(type, set)
    }
    set.add(fn)
  }

  const remove = (map: ListenerMap, type: string, fn: (event?: unknown) => void) => {
    map.get(type)?.delete(fn)
  }

  const dispatch = (map: ListenerMap, type: string, event?: unknown) => {
    for (const fn of map.get(type) ?? []) {
      fn(event)
    }
  }

  const documentElement = {
    id: 'html-root',
    requestFullscreen: vi.fn(async () => {
      fakeDoc.fullscreenElement = documentElement
      dispatch(docListeners, 'fullscreenchange')
    }),
  }

  const fakeDoc: {
    fullscreenElement: unknown
    webkitFullscreenElement?: unknown
    documentElement: typeof documentElement | null
    exitFullscreen: ReturnType<typeof vi.fn>
    addEventListener: (type: string, fn: (event?: unknown) => void) => void
    removeEventListener: (type: string, fn: (event?: unknown) => void) => void
    dispatch: (type: string, event?: unknown) => void
  } = {
    fullscreenElement: null,
    documentElement,
    exitFullscreen: vi.fn(async () => {
      fakeDoc.fullscreenElement = null
      dispatch(docListeners, 'fullscreenchange')
    }),
    addEventListener: (type, fn) => add(docListeners, type, fn),
    removeEventListener: (type, fn) => remove(docListeners, type, fn),
    dispatch: (type, event) => dispatch(docListeners, type, event),
  }

  const fakeWindow = {
    sessionStorage: {
      getItem: (key: string) => sessionEntries.get(key) ?? null,
      setItem: (key: string, value: string) => void sessionEntries.set(key, value),
      removeItem: (key: string) => void sessionEntries.delete(key),
    },
    addEventListener: (type: string, fn: (event?: unknown) => void) => add(winListeners, type, fn),
    removeEventListener: (type: string, fn: (event?: unknown) => void) => remove(winListeners, type, fn),
    dispatch: (type: string, event?: unknown) => dispatch(winListeners, type, event),
  }

  return { fakeDoc, fakeWindow, documentElement, sessionEntries }
}

describe('useFullscreenMap helpers', () => {
  it('getFullscreenElement returns standard or webkit element or null', () => {
    const el = { id: 'map' }
    expect(getFullscreenElement({ fullscreenElement: el })).toBe(el)
    expect(getFullscreenElement({ webkitFullscreenElement: el })).toBe(el)
    expect(getFullscreenElement({})).toBeNull()
    expect(getFullscreenElement(null)).toBeNull()
  })

  it('resolveFullscreenTarget prefers document.documentElement and falls back when unavailable', () => {
    const root = { requestFullscreen: vi.fn() }
    const fallback = { requestFullscreen: vi.fn() }
    expect(resolveFullscreenTarget(fallback, { documentElement: root })).toBe(root)
    expect(resolveFullscreenTarget(fallback, { documentElement: {} })).toBe(fallback)
    expect(resolveFullscreenTarget(fallback, { documentElement: null })).toBe(fallback)
    expect(resolveFullscreenTarget(null, null)).toBeNull()
  })

  it('tryRequestFullscreen uses requestFullscreen and falls back to webkitRequestFullscreen', async () => {
    const standard = vi.fn().mockResolvedValue(undefined)
    expect(await tryRequestFullscreen({ requestFullscreen: standard })).toBe(true)
    expect(standard).toHaveBeenCalledTimes(1)

    const webkit = vi.fn()
    expect(await tryRequestFullscreen({ webkitRequestFullscreen: webkit })).toBe(true)
    expect(webkit).toHaveBeenCalledTimes(1)
  })

  it('tryRequestFullscreen returns false on missing element, unsupported API, or rejection', async () => {
    expect(await tryRequestFullscreen(null)).toBe(false)
    expect(await tryRequestFullscreen({})).toBe(false)
    expect(
      await tryRequestFullscreen({
        requestFullscreen: vi.fn().mockRejectedValue(new Error('not allowed')),
      }),
    ).toBe(false)
  })

  it('tryExitFullscreen exits only when an element is fullscreen and handles errors safely', async () => {
    const exit = vi.fn().mockResolvedValue(undefined)
    expect(await tryExitFullscreen({ fullscreenElement: null, exitFullscreen: exit })).toBe(false)
    expect(exit).not.toHaveBeenCalled()

    expect(await tryExitFullscreen({ fullscreenElement: {}, exitFullscreen: exit })).toBe(true)
    expect(exit).toHaveBeenCalledTimes(1)

    const webkitExit = vi.fn()
    expect(await tryExitFullscreen({ webkitFullscreenElement: {}, webkitExitFullscreen: webkitExit })).toBe(true)
    expect(webkitExit).toHaveBeenCalledTimes(1)

    expect(
      await tryExitFullscreen({
        fullscreenElement: {},
        exitFullscreen: vi.fn().mockRejectedValue(new Error('failed')),
      }),
    ).toBe(false)
  })

  it('tryLockLandscape locks to landscape and never throws when unsupported or rejected', async () => {
    const lock = vi.fn().mockResolvedValue(undefined)
    expect(await tryLockLandscape({ lock })).toBe(true)
    expect(lock).toHaveBeenCalledWith('landscape')

    expect(await tryLockLandscape(null)).toBe(false)
    expect(await tryLockLandscape({})).toBe(false)
    expect(
      await tryLockLandscape({
        lock: vi.fn().mockRejectedValue(new Error('NotSupportedError')),
      }),
    ).toBe(false)
  })

  it('tryUnlockOrientation unlocks safely and handles missing or throwing implementations', () => {
    const unlock = vi.fn()
    expect(tryUnlockOrientation({ unlock })).toBe(true)
    expect(unlock).toHaveBeenCalledTimes(1)

    expect(tryUnlockOrientation(null)).toBe(false)
    expect(tryUnlockOrientation({})).toBe(false)
    expect(
      tryUnlockOrientation({
        unlock: () => {
          throw new Error('unsupported')
        },
      }),
    ).toBe(false)
  })
})

describe('useFullscreenMap shared store & route persistence', () => {
  beforeEach(() => {
    const { fakeDoc, fakeWindow } = createFakeDom()
    vi.stubGlobal('document', fakeDoc)
    vi.stubGlobal('window', fakeWindow)
    resetFullscreenForTests()
  })

  afterEach(() => {
    resetFullscreenForTests()
    vi.unstubAllGlobals()
  })

  it('targets document.documentElement instead of fallback <main> element', async () => {
    const fallbackMain = { requestFullscreen: vi.fn() }
    const unsub = subscribeFullscreenStoreForTests(() => {})

    await enterFullscreen(fallbackMain)

    const doc = document as unknown as ReturnType<typeof createFakeDom>['fakeDoc']
    expect(doc.documentElement?.requestFullscreen).toHaveBeenCalledTimes(1)
    expect(fallbackMain.requestFullscreen).not.toHaveBeenCalled()
    expect(getFullscreenSnapshotForTests()).toEqual({
      isMapOnly: true,
      isNativeFullscreen: true,
      isFullscreen: true,
    })

    unsub()
  })

  it('persists fullscreen and map-only state across route unmounts and remounts', async () => {
    // Route A (WorldMap) enters fullscreen
    const unsubRouteA = subscribeFullscreenStoreForTests(() => {})
    await enterFullscreen()
    expect(getFullscreenSnapshotForTests().isFullscreen).toBe(true)

    // Route A unmounts (e.g. followPlayer navigates from / to /kokiri-forest)
    unsubRouteA()

    // State remains active immediately before and as Route B (PlaceView) mounts
    expect(getFullscreenSnapshotForTests()).toEqual({
      isMapOnly: true,
      isNativeFullscreen: true,
      isFullscreen: true,
    })

    const unsubRouteB = subscribeFullscreenStoreForTests(() => {})
    expect(getFullscreenSnapshotForTests().isFullscreen).toBe(true)

    // Route B -> Route C (PlaceView -> another PlaceView) also preserves state
    unsubRouteB()
    const unsubRouteC = subscribeFullscreenStoreForTests(() => {})
    expect(getFullscreenSnapshotForTests().isFullscreen).toBe(true)

    unsubRouteC()
  })

  it('persists map-only fallback mode across route transitions when native fullscreen is rejected', async () => {
    const doc = document as unknown as ReturnType<typeof createFakeDom>['fakeDoc']
    doc.documentElement!.requestFullscreen = vi.fn().mockRejectedValue(new Error('not supported'))

    const unsubRouteA = subscribeFullscreenStoreForTests(() => {})
    await enterFullscreen()
    expect(getFullscreenSnapshotForTests()).toEqual({
      isMapOnly: true,
      isNativeFullscreen: false,
      isFullscreen: true,
    })

    // Unmount Route A and mount Route B; map-only must remain true despite !getFullscreenElement()
    unsubRouteA()
    const unsubRouteB = subscribeFullscreenStoreForTests(() => {})
    expect(getFullscreenSnapshotForTests()).toEqual({
      isMapOnly: true,
      isNativeFullscreen: false,
      isFullscreen: true,
    })

    // Pressing Escape exits map-only mode
    const win = window as unknown as ReturnType<typeof createFakeDom>['fakeWindow']
    win.dispatch('keydown', { key: 'Escape' })
    await Promise.resolve()

    expect(getFullscreenSnapshotForTests()).toEqual({
      isMapOnly: false,
      isNativeFullscreen: false,
      isFullscreen: false,
    })

    unsubRouteB()
  })

  it('clears state on explicit exitFullscreen and on real fullscreenchange exit', async () => {
    const doc = document as unknown as ReturnType<typeof createFakeDom>['fakeDoc']
    const unsub = subscribeFullscreenStoreForTests(() => {})

    await enterFullscreen()
    expect(getFullscreenSnapshotForTests().isFullscreen).toBe(true)

    // Explicit exit
    await exitFullscreen()
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1)
    expect(getFullscreenSnapshotForTests()).toEqual({
      isMapOnly: false,
      isNativeFullscreen: false,
      isFullscreen: false,
    })

    // Re-enter, then simulate browser/OS exiting native fullscreen via fullscreenchange
    await enterFullscreen()
    expect(getFullscreenSnapshotForTests().isFullscreen).toBe(true)
    doc.fullscreenElement = null
    doc.dispatch('fullscreenchange')

    expect(getFullscreenSnapshotForTests()).toEqual({
      isMapOnly: false,
      isNativeFullscreen: false,
      isFullscreen: false,
    })

    unsub()
  })
})
