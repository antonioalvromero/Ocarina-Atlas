import { describe, expect, it } from 'vitest'
import type { Dataset } from '../lib/types'
import { getCategoryDrawerItems } from './GlobalStatsDrawer'

const MOCK_DATASET: Dataset = {
  map: { image: '/hyrule.png', width: 1000, height: 1000 },
  categories: [
    { key: 'gs', name: 'Gold Skulltulas' },
    { key: 'hc', name: 'Heart Containers' },
  ],
  requirements: [],
  places: [
    {
      id: 'spirit-temple',
      slug: 'spirit-temple',
      kind: 'dungeon',
      name: 'Spirit Temple',
      region: 'Haunted Wasteland',
      intro: '',
      pin: { x: 0.1, y: 0.2 },
      maps: [],
      startMap: '1F',
    },
    {
      id: 'kokiri-forest',
      slug: 'kokiri-forest',
      kind: 'zone',
      name: 'Kokiri Forest',
      region: 'Kokiri',
      intro: '',
      pin: { x: 0.8, y: 0.7 },
      maps: [],
      startMap: 'principal',
    },
  ],
  items: [
    {
      id: 'espiritu-gs-01',
      n: 1,
      cat: 'gs',
      place: 'spirit-temple',
      at: { map: 'S1', x: 0.2, y: 0.3 },
      name: 'Basement Skulltula',
      desc: '',
      hint: null,
      age: 'adult',
      night: false,
      requires: [],
      images: [],
    },
    {
      id: 'kokiri-gs-01',
      n: 2,
      cat: 'gs',
      place: 'kokiri-forest',
      at: { map: 'principal', x: 0.4, y: 0.5 },
      name: 'Know-It-All House',
      desc: '',
      hint: null,
      age: 'child',
      night: true,
      requires: [],
      images: [],
    },
    {
      id: 'kokiri-hc-01',
      n: 3,
      cat: 'hc',
      place: 'kokiri-forest',
      at: null,
      name: 'Unplaced Heart',
      desc: '',
      hint: null,
      age: null,
      night: false,
      requires: [],
      images: [],
    },
  ],
}

describe('getCategoryDrawerItems', () => {
  it('returns only uncollected items when filter is remaining and formats floor labels', () => {
    const entries = getCategoryDrawerItems('gs', ['kokiri-gs-01'], 'remaining', MOCK_DATASET)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.item.id).toBe('espiritu-gs-01')
    expect(entries[0]?.placeName).toBe('Spirit Temple')
    expect(entries[0]?.placeSlug).toBe('spirit-temple')
    expect(entries[0]?.mapId).toBe('S1')
    expect(entries[0]?.floorLabel).toBe('B1')
    expect(entries[0]?.done).toBe(false)
  })

  it('returns both collected and remaining items when filter is all and omits principal floor label', () => {
    const entries = getCategoryDrawerItems('gs', ['kokiri-gs-01'], 'all', MOCK_DATASET)
    expect(entries).toHaveLength(2)
    expect(entries[0]?.done).toBe(false)
    expect(entries[1]?.item.id).toBe('kokiri-gs-01')
    expect(entries[1]?.done).toBe(true)
    expect(entries[1]?.mapId).toBe('principal')
    expect(entries[1]?.floorLabel).toBeNull()
  })

  it('handles unplaced items with null mapId and floorLabel', () => {
    const entries = getCategoryDrawerItems('hc', [], 'remaining', MOCK_DATASET)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.mapId).toBeNull()
    expect(entries[0]?.floorLabel).toBeNull()
  })
})
