import { describe, expect, it } from 'vitest'
import { itemsOfPlace } from './data'
import {
  computeRelativeBearing,
  DEFAULT_NEAREST_MAX_DISTANCE,
  DEFAULT_NEAREST_MAX_METERS,
  findNearestReachableCollectible,
  stepContinuousAngle,
} from './nearest-collectible'
import type { Item } from './types'

function makeItem(overrides: Partial<Item> & Pick<Item, 'id'>): Item {
  return {
    n: 1,
    cat: 'skulltulas',
    place: 'kokiri',
    at: { map: 'principal', x: 0.5, y: 0.5 },
    name: overrides.id,
    desc: '',
    hint: null,
    age: null,
    night: false,
    requires: [],
    images: [],
    ...overrides,
  }
}

describe('findNearestReachableCollectible', () => {
  it('returns null when placeId, mapId, or mapFraction is missing', () => {
    const items = [makeItem({ id: 'a' })]
    const base = {
      placeId: 'kokiri',
      mapId: 'principal',
      mapFraction: { x: 0.5, y: 0.5 },
      age: 'child' as const,
      doneIds: new Set<string>(),
      ownedExpanded: new Set<string>(),
      items,
    }

    expect(findNearestReachableCollectible({ ...base, placeId: null })).toBeNull()
    expect(findNearestReachableCollectible({ ...base, mapId: undefined })).toBeNull()
    expect(findNearestReachableCollectible({ ...base, mapFraction: null })).toBeNull()
  })

  it('returns the nearest reachable item with normalized distance, meters, and bearing', () => {
    const north = makeItem({ id: 'north', at: { map: 'principal', x: 0.5, y: 0.4 } })
    const east = makeItem({ id: 'east', at: { map: 'principal', x: 0.65, y: 0.5 } })

    const match = findNearestReachableCollectible({
      placeId: 'kokiri',
      mapId: 'principal',
      mapFraction: { x: 0.5, y: 0.5 },
      age: 'child',
      doneIds: new Set(),
      ownedExpanded: new Set(),
      items: [east, north],
    })

    expect(match).not.toBeNull()
    expect(match!.item.id).toBe('north')
    expect(match!.distanceNormalized).toBeCloseTo(0.1, 6)
    expect(match!.distanceMeters).toBe(25)
    expect(match!.bearingDeg).toBeCloseTo(0, 6)
  })

  it('computes clockwise bearings from North and clamps distanceMeters to at least 1', () => {
    const base = {
      placeId: 'kokiri',
      mapId: 'principal',
      mapFraction: { x: 0.5, y: 0.5 },
      age: null,
      doneIds: new Set<string>(),
      ownedExpanded: new Set<string>(),
    }

    const east = findNearestReachableCollectible({
      ...base,
      items: [makeItem({ id: 'e', at: { map: 'principal', x: 0.6, y: 0.5 } })],
    })
    expect(east?.bearingDeg).toBeCloseTo(90, 6)

    const south = findNearestReachableCollectible({
      ...base,
      items: [makeItem({ id: 's', at: { map: 'principal', x: 0.5, y: 0.6 } })],
    })
    expect(south?.bearingDeg).toBeCloseTo(180, 6)

    const west = findNearestReachableCollectible({
      ...base,
      items: [makeItem({ id: 'w', at: { map: 'principal', x: 0.4, y: 0.5 } })],
    })
    expect(west?.bearingDeg).toBeCloseTo(270, 6)

    const veryClose = findNearestReachableCollectible({
      ...base,
      items: [makeItem({ id: 'close', at: { map: 'principal', x: 0.5, y: 0.5 } })],
    })
    expect(veryClose?.distanceMeters).toBe(1)
    expect(veryClose?.bearingDeg).toBe(0)
  })

  it('skips completed items and items on other maps or without coordinates', () => {
    const doneItem = makeItem({ id: 'done', at: { map: 'principal', x: 0.51, y: 0.5 } })
    const otherMap = makeItem({ id: 'other-map', at: { map: '1F', x: 0.51, y: 0.5 } })
    const unplaced = makeItem({ id: 'unplaced', at: null })
    const available = makeItem({ id: 'available', at: { map: 'principal', x: 0.6, y: 0.5 } })

    const match = findNearestReachableCollectible({
      placeId: 'kokiri',
      mapId: 'principal',
      mapFraction: { x: 0.5, y: 0.5 },
      age: 'child',
      doneIds: new Set(['done']),
      ownedExpanded: new Set(),
      items: [doneItem, otherMap, unplaced, available],
    })

    expect(match?.item.id).toBe('available')
  })

  it('skips items requiring missing gear and honors beanEvalOptions', () => {
    const needsHookshot = makeItem({
      id: 'hookshot-item',
      at: { map: 'principal', x: 0.52, y: 0.5 },
      requires: ['hookshot'],
    })
    const needsBean = makeItem({
      id: 'perdido-gs-03',
      place: 'perdido',
      at: { map: 'principal', x: 0.55, y: 0.5 },
      requires: ['planted-bean'],
    })
    const fallback = makeItem({
      id: 'fallback',
      at: { map: 'principal', x: 0.65, y: 0.5 },
      requires: [],
    })

    const withoutGear = findNearestReachableCollectible({
      placeId: 'perdido',
      mapId: 'principal',
      mapFraction: { x: 0.5, y: 0.5 },
      age: 'adult',
      doneIds: new Set(),
      ownedExpanded: new Set(),
      beanEvalOptions: { beanAutoSynced: true, collectedBeanIds: new Set() },
      items: [needsHookshot, needsBean, fallback],
    })
    expect(withoutGear?.item.id).toBe('fallback')

    const withBean = findNearestReachableCollectible({
      placeId: 'perdido',
      mapId: 'principal',
      mapFraction: { x: 0.5, y: 0.5 },
      age: 'adult',
      doneIds: new Set(),
      ownedExpanded: new Set(),
      beanEvalOptions: { beanAutoSynced: true, collectedBeanIds: new Set(['perdido-bean-02']) },
      items: [needsHookshot, needsBean, fallback],
    })
    expect(withBean?.item.id).toBe('perdido-gs-03')
  })

  it('skips wrong-age items while allowing null and both ages', () => {
    const adultOnly = makeItem({ id: 'adult-only', age: 'adult', at: { map: 'principal', x: 0.51, y: 0.5 } })
    const bothAge = makeItem({ id: 'both-age', age: 'both', at: { map: 'principal', x: 0.58, y: 0.5 } })
    const nullAge = makeItem({ id: 'null-age', age: null, at: { map: 'principal', x: 0.62, y: 0.5 } })

    const childMatch = findNearestReachableCollectible({
      placeId: 'kokiri',
      mapId: 'principal',
      mapFraction: { x: 0.5, y: 0.5 },
      age: 'child',
      doneIds: new Set(),
      ownedExpanded: new Set(),
      items: [adultOnly, bothAge, nullAge],
    })
    expect(childMatch?.item.id).toBe('both-age')

    const anyAgeMatch = findNearestReachableCollectible({
      placeId: 'kokiri',
      mapId: 'principal',
      mapFraction: { x: 0.5, y: 0.5 },
      age: null,
      doneIds: new Set(),
      ownedExpanded: new Set(),
      items: [adultOnly, bothAge, nullAge],
    })
    expect(anyAgeMatch?.item.id).toBe('adult-only')
  })

  it('enforces the 57m default threshold (triggers at <= 57m, returns null at 58m+) unless overridden', () => {
    expect(DEFAULT_NEAREST_MAX_METERS).toBe(57)
    expect(DEFAULT_NEAREST_MAX_DISTANCE).toBeCloseTo(0.228, 6)

    const at57m = makeItem({
      id: 'at-57m',
      at: { map: 'principal', x: 0.5 + 57 / 250, y: 0.5 },
    })
    const at58m = makeItem({
      id: 'at-58m',
      at: { map: 'principal', x: 0.5 + 58 / 250, y: 0.5 },
    })

    const match57 = findNearestReachableCollectible({
      placeId: 'kokiri',
      mapId: 'principal',
      mapFraction: { x: 0.5, y: 0.5 },
      age: 'child',
      doneIds: new Set(),
      ownedExpanded: new Set(),
      items: [at57m],
    })
    expect(match57?.item.id).toBe('at-57m')
    expect(match57?.distanceMeters).toBe(57)

    expect(
      findNearestReachableCollectible({
        placeId: 'kokiri',
        mapId: 'principal',
        mapFraction: { x: 0.5, y: 0.5 },
        age: 'child',
        doneIds: new Set(),
        ownedExpanded: new Set(),
        items: [at58m],
      }),
    ).toBeNull()

    const customMatch = findNearestReachableCollectible({
      placeId: 'kokiri',
      mapId: 'principal',
      mapFraction: { x: 0.5, y: 0.5 },
      age: 'child',
      doneIds: new Set(),
      ownedExpanded: new Set(),
      maxNormalizedDistance: 0.35,
      items: [at58m],
    })
    expect(customMatch?.item.id).toBe('at-58m')
    expect(customMatch?.distanceMeters).toBe(58)
  })

  it('loads items from itemsOfPlace(placeId) when items is omitted', () => {
    const kokiriItems = itemsOfPlace('kokiri')
    const target = kokiriItems.find((item) => item.at !== null)
    expect(target?.at).toBeTruthy()

    const match = findNearestReachableCollectible({
      placeId: 'kokiri',
      mapId: target!.at!.map,
      mapFraction: { x: target!.at!.x, y: target!.at!.y },
      age: null,
      doneIds: new Set(),
      ownedExpanded: new Set(kokiriItems.flatMap((i) => i.requires.flat())),
    })
    expect(match).not.toBeNull()
    expect(match!.item.id).toBe(target!.id)
  })

  it('computes relative bearing from Link facing yaw and wraps smoothly across 360 degrees', () => {
    // Item due East (90°), Link facing East (90°) -> straight ahead (0°)
    expect(computeRelativeBearing(90, 90)).toBeCloseTo(0, 6)
    // Item due East (90°), Link facing North (0°) -> to Link's right (90°)
    expect(computeRelativeBearing(90, 0)).toBeCloseTo(90, 6)
    // Item due North (0°), Link facing East (90°) -> to Link's left (270°)
    expect(computeRelativeBearing(0, 90)).toBeCloseTo(270, 6)
    // Missing yaw falls back to absolute map bearing
    expect(computeRelativeBearing(135, null)).toBeCloseTo(135, 6)
    // Shortest-path angle stepping across 350° -> 10°
    expect(stepContinuousAngle(350, 10)).toBeCloseTo(370, 6)
    expect(stepContinuousAngle(10, 350)).toBeCloseTo(-10, 6)
  })
})
