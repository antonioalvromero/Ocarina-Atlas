import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LichiiTelemetryState } from './lichii-types'
import {
  activeProfileSlot,
  addPin,
  officialDoneSlot,
  officialRevealedSlot,
  officialVisibleSlot,
  ownedPrereqsSlot,
  pinsSlot,
  prereqAutoSyncSlot,
  read,
  resetSyncForTests,
  write,
  zoomSlot,
} from './storage'
import {
  TRACKED_BEAN_IDS,
  TRACKED_BOTTLE_IDS,
  TRACKED_FAIRY_IDS,
  TRACKED_HEART_CONTAINER_IDS,
  TRACKED_HEART_PIECE_IDS,
  TRACKED_THOUGHT_IDS,
  applyTelemetryState,
  getLichiiPositionSnapshot,
  getTrackerSnapshotForTests,
  mergeOwnedRequirements,
  reconcileBeanLists,
  reconcileBottleLists,
  reconcileFairyLists,
  reconcileHeartContainerLists,
  reconcileHeartPieceLists,
  reconcileThoughtLists,
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
      removeItem: (key: string) => void entries.delete(key),
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
  it('tracks all 8 Dungeon Heart Containers and preserves non-container items', () => {
    const allDungeonHeartContainers = [
      'deku-heart-01',
      'dodongos-heart-01',
      'jabu-heart-01',
      'bosque-heart-01',
      'fuego-heart-01',
      'agua-heart-01',
      'sombra-heart-01',
      'espiritu-heart-01',
    ]
    expect(TRACKED_HEART_CONTAINER_IDS.size).toBe(8)
    for (const id of allDungeonHeartContainers) {
      expect(TRACKED_HEART_CONTAINER_IDS.has(id)).toBe(true)
    }

    const added = reconcileHeartContainerLists({
      doneList: ['kakariko-heart-01'],
      revealedList: ['kakariko-heart-01'],
      collectedIds: ['espiritu-heart-01', 'deku-heart-01', 'unknown-container-99'],
      authoritative: true,
    })

    expect(added.nextDone).toEqual(['kakariko-heart-01', 'espiritu-heart-01', 'deku-heart-01'])
    expect(added.nextRevealed).toEqual(['kakariko-heart-01', 'espiritu-heart-01', 'deku-heart-01'])
    expect(added.addedIds).toEqual(['espiritu-heart-01', 'deku-heart-01'])
    expect(added.removedIds).toEqual([])

    const reloaded = reconcileHeartContainerLists({
      doneList: ['kakariko-heart-01', 'deku-heart-01', 'espiritu-heart-01'],
      revealedList: ['kakariko-heart-01', 'deku-heart-01', 'espiritu-heart-01'],
      collectedIds: ['deku-heart-01'],
      authoritative: true,
    })

    expect(reloaded.nextDone).toEqual(['kakariko-heart-01', 'deku-heart-01'])
    expect(reloaded.nextRevealed).toEqual(['kakariko-heart-01', 'deku-heart-01'])
    expect(reloaded.removedIds).toEqual(['espiritu-heart-01'])
    expect(reloaded.doneChanged).toBe(true)
  })
})

describe('reconcileHeartPieceLists', () => {
  it('tracks all 36 Pieces of Heart and preserves non-heart-piece items', () => {
    expect(TRACKED_HEART_PIECE_IDS.size).toBe(36)
    expect(TRACKED_HEART_PIECE_IDS.has('kakariko-heart-01')).toBe(true)
    expect(TRACKED_HEART_PIECE_IDS.has('crater-heart-03')).toBe(true)
    expect(TRACKED_HEART_PIECE_IDS.has('espiritu-heart-01')).toBe(false)

    const added = reconcileHeartPieceLists({
      doneList: ['deku-heart-01'],
      revealedList: ['deku-heart-01'],
      collectedIds: ['kakariko-heart-01', 'valle-heart-01', 'unknown-heart-99'],
      authoritative: true,
    })

    expect(added.nextDone).toEqual(['deku-heart-01', 'kakariko-heart-01', 'valle-heart-01'])
    expect(added.nextRevealed).toEqual(['deku-heart-01', 'kakariko-heart-01', 'valle-heart-01'])
    expect(added.addedIds).toEqual(['kakariko-heart-01', 'valle-heart-01'])
    expect(added.removedIds).toEqual([])

    const reloaded = reconcileHeartPieceLists({
      doneList: ['deku-heart-01', 'kakariko-heart-01', 'valle-heart-01'],
      revealedList: ['deku-heart-01', 'kakariko-heart-01', 'valle-heart-01'],
      collectedIds: ['kakariko-heart-01'],
      authoritative: true,
    })

    expect(reloaded.nextDone).toEqual(['deku-heart-01', 'kakariko-heart-01'])
    expect(reloaded.nextRevealed).toEqual(['deku-heart-01', 'kakariko-heart-01'])
    expect(reloaded.removedIds).toEqual(['valle-heart-01'])
    expect(reloaded.doneChanged).toBe(true)
  })
})

describe('reconcileBeanLists, reconcileFairyLists, reconcileBottleLists, reconcileThoughtLists', () => {
  it('exposes tracked ID sets and reconciles bean, fairy, bottle, and thought lists', () => {
    expect(TRACKED_BEAN_IDS.size).toBeGreaterThan(0)
    expect(TRACKED_FAIRY_IDS.size).toBeGreaterThan(0)
    expect(TRACKED_BOTTLE_IDS.size).toBeGreaterThan(0)
    expect(TRACKED_THOUGHT_IDS.size).toBeGreaterThan(0)

    const beanId = Array.from(TRACKED_BEAN_IDS)[0]!
    const fairyId = Array.from(TRACKED_FAIRY_IDS)[0]!
    const bottleId = Array.from(TRACKED_BOTTLE_IDS)[0]!
    const thoughtId = Array.from(TRACKED_THOUGHT_IDS)[0]!

    expect(
      reconcileBeanLists({ doneList: [], revealedList: [], collectedIds: [beanId], authoritative: true }).addedIds,
    ).toEqual([beanId])
    expect(
      reconcileFairyLists({ doneList: [], revealedList: [], collectedIds: [fairyId], authoritative: true }).addedIds,
    ).toEqual([fairyId])
    expect(
      reconcileBottleLists({ doneList: [], revealedList: [], collectedIds: [bottleId], authoritative: true }).addedIds,
    ).toEqual([bottleId])
    expect(
      reconcileThoughtLists({ doneList: [], revealedList: [], collectedIds: [thoughtId], authoritative: true }).addedIds,
    ).toEqual([thoughtId])
  })
})

describe('applyTelemetryState Heart Container auto-marking', () => {
  it('auto-marks espiritu-heart-01 with a toast on live pickup while preserving kakariko-heart-01', () => {
    write(officialDoneSlot, ['kakariko-heart-01'])
    write(officialRevealedSlot, ['kakariko-heart-01'])

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

    expect(read(officialDoneSlot)).toEqual(['kakariko-heart-01', 'espiritu-heart-01'])
    expect(read(officialRevealedSlot)).toEqual(['kakariko-heart-01', 'espiritu-heart-01'])

    const toasts = getTrackerSnapshotForTests().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({
      itemId: 'espiritu-heart-01',
      itemName: 'Heart Container collected: Heart Container - Twinrova',
      placeName: 'Spirit Temple',
      skulltulaCount: null,
    })

    // Save reload without Twinrova Heart Container unmarks espiritu-heart-01 but keeps kakariko-heart-01
    applyTelemetryState(
      makeTelemetry({
        collectedHeartContainerIds: [],
        authoritativeHeartContainers: true,
      }),
    )
    expect(read(officialDoneSlot)).toEqual(['kakariko-heart-01'])
    expect(read(officialRevealedSlot)).toEqual(['kakariko-heart-01'])
  })

  it('ignores Heart Container reconciliation when source is none or not authoritative', () => {
    write(officialDoneSlot, ['kakariko-heart-01'])

    applyTelemetryState(
      makeTelemetry({
        source: 'none',
        connected: false,
        emulatorRunning: false,
        collectedHeartContainerIds: ['espiritu-heart-01'],
        authoritativeHeartContainers: true,
      }),
    )
    expect(read(officialDoneSlot)).toEqual(['kakariko-heart-01'])

    applyTelemetryState(
      makeTelemetry({
        collectedHeartContainerIds: ['espiritu-heart-01'],
        authoritativeHeartContainers: false,
      }),
    )
    expect(read(officialDoneSlot)).toEqual(['kakariko-heart-01'])
    expect(getTrackerSnapshotForTests().toasts).toHaveLength(0)
  })
})

describe('applyTelemetryState Fairy Thought auto-marking', () => {
  it('auto-marks cementerio-thought-01 with a toast and unmarks on save reload', () => {
    write(officialDoneSlot, ['deku-heart-01'])
    write(officialRevealedSlot, ['deku-heart-01'])

    applyTelemetryState(
      makeTelemetry({
        collectedThoughtIds: [],
        authoritativeThoughts: true,
      }),
    )
    expect(getTrackerSnapshotForTests().toasts).toHaveLength(0)

    applyTelemetryState(
      makeTelemetry({
        collectedThoughtIds: ['cementerio-thought-01'],
        authoritativeThoughts: true,
      }),
    )

    expect(read(officialDoneSlot)).toEqual(['deku-heart-01', 'cementerio-thought-01'])
    expect(read(officialRevealedSlot)).toEqual(['deku-heart-01', 'cementerio-thought-01'])

    const toasts = getTrackerSnapshotForTests().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({
      itemId: 'cementerio-thought-01',
      itemName: "Fairy Thought read: Broken pedestal in the Royal Family's Tomb",
      skulltulaCount: null,
    })

    applyTelemetryState(
      makeTelemetry({
        collectedThoughtIds: [],
        authoritativeThoughts: true,
      }),
    )
    expect(read(officialDoneSlot)).toEqual(['deku-heart-01'])
    expect(read(officialRevealedSlot)).toEqual(['deku-heart-01'])
  })

  it('syncs authoritative collectibles in save-only mode without emitting toasts', () => {
    write(officialDoneSlot, ['espiritu-gs-04'])

    applyTelemetryState(
      makeTelemetry({
        source: 'save',
        connected: false,
        emulatorRunning: false,
        collectedThoughtIds: ['cementerio-thought-01'],
        authoritativeThoughts: true,
        collectedHeartContainerIds: ['espiritu-heart-01'],
        authoritativeHeartContainers: true,
      }),
    )
    expect(read(officialDoneSlot)).toEqual([
      'espiritu-gs-04',
      'espiritu-heart-01',
      'cementerio-thought-01',
    ])
    expect(read(officialRevealedSlot)).toEqual(['espiritu-heart-01', 'cementerio-thought-01'])
    expect(getTrackerSnapshotForTests().toasts).toHaveLength(0)

    // Subsequent save-only update adding 1 item should also emit 0 toasts
    applyTelemetryState(
      makeTelemetry({
        source: 'save',
        connected: false,
        emulatorRunning: false,
        collectedThoughtIds: ['cementerio-thought-01', 'coloso-thought-01'],
        authoritativeThoughts: true,
        collectedHeartContainerIds: ['espiritu-heart-01'],
        authoritativeHeartContainers: true,
      }),
    )
    expect(read(officialDoneSlot)).toEqual([
      'espiritu-gs-04',
      'espiritu-heart-01',
      'cementerio-thought-01',
      'coloso-thought-01',
    ])
    expect(getTrackerSnapshotForTests().toasts).toHaveLength(0)
  })

  it('ignores Fairy Thought reconciliation when source is none or not authoritative', () => {
    write(officialDoneSlot, ['espiritu-gs-04'])

    applyTelemetryState(
      makeTelemetry({
        source: 'none',
        connected: false,
        emulatorRunning: false,
        collectedThoughtIds: ['cementerio-thought-01'],
        authoritativeThoughts: true,
      }),
    )
    expect(read(officialDoneSlot)).toEqual(['espiritu-gs-04'])

    applyTelemetryState(
      makeTelemetry({
        collectedThoughtIds: ['cementerio-thought-01'],
        authoritativeThoughts: false,
      }),
    )
    expect(read(officialDoneSlot)).toEqual(['espiritu-gs-04'])
    expect(getTrackerSnapshotForTests().toasts).toHaveLength(0)
  })
})

describe('position snapshot and short-circuiting', () => {
  it('updates getLichiiPositionSnapshot on position ticks without re-running category reconciliation', () => {
    applyTelemetryState(
      makeTelemetry({
        collectedSkulltulaIds: ['espiritu-gs-04'],
        authoritativeSkulltulas: true,
        position: { x: 10, y: 20, z: 30, yaw: 90 },
        mapFraction: { x: 0.25, y: 0.5 },
        worldMapFraction: { x: 0.1, y: 0.2 },
      }),
    )

    const firstPos = getLichiiPositionSnapshot()
    expect(firstPos).toEqual({
      position: { x: 10, y: 20, z: 30, yaw: 90 },
      mapFraction: { x: 0.25, y: 0.5 },
      worldMapFraction: { x: 0.1, y: 0.2 },
    })

    // Identical position tick should preserve snapshot object reference
    applyTelemetryState(
      makeTelemetry({
        collectedSkulltulaIds: ['espiritu-gs-04'],
        authoritativeSkulltulas: true,
        position: { x: 10, y: 20, z: 30, yaw: 90 },
        mapFraction: { x: 0.25, y: 0.5 },
        worldMapFraction: { x: 0.1, y: 0.2 },
        updatedAt: 2000,
      }),
    )
    expect(getLichiiPositionSnapshot()).toBe(firstPos)

    // New position tick with fresh array instance containing same IDs updates position cleanly
    applyTelemetryState(
      makeTelemetry({
        collectedSkulltulaIds: ['espiritu-gs-04'],
        authoritativeSkulltulas: true,
        position: { x: 15, y: 20, z: 35, yaw: 180 },
        mapFraction: { x: 0.3, y: 0.55 },
        worldMapFraction: { x: 0.12, y: 0.22 },
        updatedAt: 3000,
      }),
    )
    const secondPos = getLichiiPositionSnapshot()
    expect(secondPos).not.toBe(firstPos)
    expect(secondPos.position).toEqual({ x: 15, y: 20, z: 35, yaw: 180 })
    expect(read(officialDoneSlot)).toEqual(['espiritu-gs-04'])
  })
})

describe('applyTelemetryState prerequisite auto-sync', () => {
  it('merges live ownedRequirements into ownedPrereqsSlot while preserving manual entries', () => {
    write(ownedPrereqsSlot, ['bugs'])

    applyTelemetryState(
      makeTelemetry({
        ownedRequirements: ['bombs', 'hookshot'],
      }),
    )
    expect(read(ownedPrereqsSlot)).toEqual(['bugs', 'bombs', 'hookshot'])

    // Manual uncheck of 'bombs' is not immediately overwritten while signature is unchanged
    write(ownedPrereqsSlot, ['bugs', 'hookshot'])
    applyTelemetryState(
      makeTelemetry({
        ownedRequirements: ['bombs', 'hookshot'],
      }),
    )
    expect(read(ownedPrereqsSlot)).toEqual(['bugs', 'hookshot'])

    // Picking up a new item updates signature and merges the new item cleanly
    applyTelemetryState(
      makeTelemetry({
        ownedRequirements: ['bombs', 'hookshot', 'zeldas-lullaby'],
      }),
    )
    expect(read(ownedPrereqsSlot)).toEqual(['bugs', 'hookshot', 'bombs', 'zeldas-lullaby'])
  })

  it('syncs ownedRequirements in save-only mode without emitting toasts', () => {
    write(ownedPrereqsSlot, ['ocarina'])
    write(prereqAutoSyncSlot, true)

    applyTelemetryState(
      makeTelemetry({
        source: 'save',
        connected: false,
        emulatorRunning: false,
        ownedRequirements: ['bombs', 'bow'],
      }),
    )
    expect(read(ownedPrereqsSlot)).toEqual(['ocarina', 'bombs', 'bow'])
    expect(getTrackerSnapshotForTests().toasts).toHaveLength(0)
  })

  it('skips auto-sync when prereqAutoSyncSlot is false or source is none', () => {
    write(ownedPrereqsSlot, ['ocarina'])
    write(prereqAutoSyncSlot, false)

    applyTelemetryState(
      makeTelemetry({
        ownedRequirements: ['bombs', 'bow'],
      }),
    )
    expect(read(ownedPrereqsSlot)).toEqual(['ocarina'])

    write(prereqAutoSyncSlot, true)
    applyTelemetryState(
      makeTelemetry({
        source: 'none',
        connected: false,
        emulatorRunning: false,
        ownedRequirements: ['bombs', 'bow'],
      }),
    )
    expect(read(ownedPrereqsSlot)).toEqual(['ocarina'])

    expect(mergeOwnedRequirements(['ocarina'], ['ocarina'])).toEqual({
      next: ['ocarina'],
      changed: false,
    })
  })

  it('isolates custom pins, manual reveals, and telemetry collectibles when activeSaveSlot switches between slot_00 and slot_01', () => {
    write(officialVisibleSlot, true)
    write(zoomSlot, 2.2)

    applyTelemetryState(
      makeTelemetry({
        activeSaveSlot: 'slot_00',
        authoritativeSkulltulas: true,
        collectedSkulltulaIds: ['deku-gs-01'],
        ownedRequirements: ['bombs'],
      }),
    )
    expect(read(activeProfileSlot)).toBe('slot_00')
    addPin('kokiri', 'principal', 'Slot 0 Note', { x: 0.3, y: 0.4 }, 'other')
    write(officialRevealedSlot, [...read(officialRevealedSlot), 'manual-reveal-0'])

    applyTelemetryState(
      makeTelemetry({
        activeSaveSlot: 'slot_01',
        authoritativeSkulltulas: true,
        collectedSkulltulaIds: ['espiritu-gs-01'],
        ownedRequirements: ['bow'],
      }),
    )
    expect(read(activeProfileSlot)).toBe('slot_01')
    expect(read(officialDoneSlot)).toEqual(['espiritu-gs-01'])
    expect(read(officialRevealedSlot)).toEqual(['espiritu-gs-01'])
    expect(read(ownedPrereqsSlot)).toEqual(['bow'])
    expect(read(pinsSlot('kokiri', 'principal'))).toEqual([])
    expect(read(officialVisibleSlot)).toBe(true)
    expect(read(zoomSlot)).toBe(2.2)

    addPin('kokiri', 'principal', 'Slot 1 Note', { x: 0.6, y: 0.7 }, 'other')

    applyTelemetryState(
      makeTelemetry({
        activeSaveSlot: 'slot_00',
        authoritativeSkulltulas: true,
        collectedSkulltulaIds: ['deku-gs-01'],
        ownedRequirements: ['bombs'],
      }),
    )
    expect(read(activeProfileSlot)).toBe('slot_00')
    expect(read(officialDoneSlot)).toEqual(['deku-gs-01'])
    expect(read(officialRevealedSlot)).toEqual(['deku-gs-01', 'manual-reveal-0'])
    expect(read(ownedPrereqsSlot)).toEqual(['bombs'])
    expect(read(pinsSlot('kokiri', 'principal')).map((p) => p.name)).toEqual(['Slot 0 Note'])
  })
})
