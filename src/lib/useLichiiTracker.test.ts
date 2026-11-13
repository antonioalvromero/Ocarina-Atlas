import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LichiiTelemetryState } from './lichii-types'
import { officialDoneSlot, officialRevealedSlot, read, resetSyncForTests, write } from './storage'
import {
  TRACKED_HEART_CONTAINER_IDS,
  applyTelemetryState,
  getTrackerSnapshotForTests,
  reconcileHeartContainerLists,
  resetTrackerForTests,
} from './useLichiiTracker'

function fakeWindow() {
  const entries = new Map<string, string>()
  return {
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: {
      get length() {
        return entries.size
      },
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
    },
  }
}

function makeTelemetry(overrides: Partial<LichiiTelemetryState> = {}): LichiiTelemetryState {
  return {
    connected: true,
    emulatorRunning: true,
    scene: 'SpiritTemple',
    placeId: 'espiritu',
    placeSlug: 'spirit-temple',
    placeName: 'Spirit Temple',
    mapId: '2F',
    age: 'adult',
    position: null,
    mapFraction: null,
    worldMapFraction: null,
    skulltulaCount: 0,
    collectedSkulltulaIds: [],
    authoritativeSkulltulas: false,
    lastCollectedSkulltulaId: null,
    lastPickedItem: null,
    source: 'memory',
    updatedAt: 1000,
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal('window', fakeWindow())
  resetSyncForTests()
  resetTrackerForTests()
})

afterEach(() => {
  resetSyncForTests()
  resetTrackerForTests()
  vi.unstubAllGlobals()
})

describe('reconcileHeartContainerLists', () => {
  it('tracks only verified Heart Containers and preserves unmapped ones like deku-heart-01', () => {
    expect(TRACKED_HEART_CONTAINER_IDS.has('espiritu-heart-01')).toBe(true)
    expect(TRACKED_HEART_CONTAINER_IDS.has('deku-heart-01')).toBe(false)

    const added = reconcileHeartContainerLists({
      doneList: ['deku-heart-01'],
      revealedList: ['deku-heart-01'],
      collectedIds: ['espiritu-heart-01', 'deku-heart-01'],
      authoritative: true,
    })

    expect(added.nextDone).toEqual(['deku-heart-01', 'espiritu-heart-01'])
    expect(added.nextRevealed).toEqual(['deku-heart-01', 'espiritu-heart-01'])
    expect(added.addedIds).toEqual(['espiritu-heart-01'])
    expect(added.removedIds).toEqual([])

    const reloaded = reconcileHeartContainerLists({
      doneList: ['deku-heart-01', 'espiritu-heart-01'],
      revealedList: ['deku-heart-01', 'espiritu-heart-01'],
      collectedIds: [],
      authoritative: true,
    })

    expect(reloaded.nextDone).toEqual(['deku-heart-01'])
    expect(reloaded.nextRevealed).toEqual(['deku-heart-01'])
    expect(reloaded.removedIds).toEqual(['espiritu-heart-01'])
    expect(reloaded.doneChanged).toBe(true)
  })
})

describe('applyTelemetryState Heart Container auto-marking', () => {
  it('auto-marks espiritu-heart-01 with a toast on live pickup while preserving deku-heart-01', () => {
    write(officialDoneSlot, ['deku-heart-01'])
    write(officialRevealedSlot, ['deku-heart-01'])

    // Initial authoritative sync establishes baseline without firing a toast
    applyTelemetryState(
      makeTelemetry({
        collectedHeartContainerIds: [],
        authoritativeHeartContainers: true,
      }),
    )
    expect(getTrackerSnapshotForTests().toasts).toHaveLength(0)

    // Live pickup of Twinrova Heart Container
    applyTelemetryState(
      makeTelemetry({
        collectedHeartContainerIds: ['espiritu-heart-01'],
        authoritativeHeartContainers: true,
      }),
    )

    expect(read(officialDoneSlot)).toEqual(['deku-heart-01', 'espiritu-heart-01'])
    expect(read(officialRevealedSlot)).toEqual(['deku-heart-01', 'espiritu-heart-01'])

    const toasts = getTrackerSnapshotForTests().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({
      itemId: 'espiritu-heart-01',
      itemName: 'Heart Container collected: Heart Container - Twinrova',
      placeName: 'Spirit Temple',
      skulltulaCount: null,
    })

    // Save reload without Twinrova Heart Container unmarks espiritu-heart-01 but keeps deku-heart-01
    applyTelemetryState(
      makeTelemetry({
        collectedHeartContainerIds: [],
        authoritativeHeartContainers: true,
      }),
    )
    expect(read(officialDoneSlot)).toEqual(['deku-heart-01'])
    expect(read(officialRevealedSlot)).toEqual(['deku-heart-01'])
  })

  it('ignores Heart Container reconciliation when not live memory or not authoritative', () => {
    write(officialDoneSlot, ['deku-heart-01'])

    applyTelemetryState(
      makeTelemetry({
        source: 'save',
        connected: false,
        emulatorRunning: false,
        collectedHeartContainerIds: ['espiritu-heart-01'],
        authoritativeHeartContainers: true,
      }),
    )
    expect(read(officialDoneSlot)).toEqual(['deku-heart-01'])

    applyTelemetryState(
      makeTelemetry({
        collectedHeartContainerIds: ['espiritu-heart-01'],
        authoritativeHeartContainers: false,
      }),
    )
    expect(read(officialDoneSlot)).toEqual(['deku-heart-01'])
    expect(getTrackerSnapshotForTests().toasts).toHaveLength(0)
  })
})
