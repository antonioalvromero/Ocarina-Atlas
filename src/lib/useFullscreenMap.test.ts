import { describe, expect, it, vi } from 'vitest'
import {
  getFullscreenElement,
  tryExitFullscreen,
  tryLockLandscape,
  tryRequestFullscreen,
  tryUnlockOrientation,
} from './useFullscreenMap'

describe('useFullscreenMap helpers', () => {
  it('getFullscreenElement returns standard or webkit element or null', () => {
    const el = { id: 'map' }
    expect(getFullscreenElement({ fullscreenElement: el })).toBe(el)
    expect(getFullscreenElement({ webkitFullscreenElement: el })).toBe(el)
    expect(getFullscreenElement({})).toBeNull()
    expect(getFullscreenElement(null)).toBeNull()
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
