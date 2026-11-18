import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { expandOwnedRequirements } from '../lib/prerequisites'
import type { GlobalProgressSummary } from '../lib/progress-stats'
import type { Dataset } from '../lib/types'
import { filterPlacesForDrawer, GlobalStatsDrawer, getCategoryDrawerItems } from './GlobalStatsDrawer'

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
      requires: ['longshot'],
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

  it('filters items by owned prerequisites when onlyReachable is enabled', () => {
    const withoutGear = getCategoryDrawerItems('gs', [], 'remaining', MOCK_DATASET, {
      onlyReachable: true,
      ownedExpanded: expandOwnedRequirements([]),
    })
    expect(withoutGear.map((e) => e.item.id)).toEqual(['kokiri-gs-01'])

    const withLongshot = getCategoryDrawerItems('gs', [], 'remaining', MOCK_DATASET, {
      onlyReachable: true,
      ownedExpanded: expandOwnedRequirements(['longshot']),
    })
    expect(withLongshot.map((e) => e.item.id)).toEqual(['espiritu-gs-01', 'kokiri-gs-01'])
  })
})

describe('GlobalStatsDrawer official pins toggle', () => {
  const emptySummary: GlobalProgressSummary = {
    totalDone: 0,
    totalItems: 0,
    percentage: 0,
    completedPlaces: 0,
    totalPlaces: 0,
    categories: [],
    places: [],
  }

  it('renders the Show official pins switch above the Only reachable filter', () => {
    const html = renderToString(
      createElement(GlobalStatsDrawer, {
        open: true,
        onClose: () => {},
        summary: emptySummary,
      }),
    )
    expect(html).toContain('Show official pins')
    expect(html).toContain('role="switch"')
    expect(html).toContain('Only reachable')
    expect(html).toContain('Hide completed')
    expect(html.indexOf('Show official pins')).toBeLessThan(html.indexOf('Only reachable'))
  })
})

describe('filterPlacesForDrawer', () => {
  const places: GlobalProgressSummary['places'] = [
    {
      id: 'kokiri-forest',
      slug: 'kokiri-forest',
      name: 'Kokiri Forest',
      region: 'Kokiri',
      kind: 'zone',
      done: 5,
      total: 5,
      percentage: 100,
    },
    {
      id: 'spirit-temple',
      slug: 'spirit-temple',
      name: 'Spirit Temple',
      region: 'Haunted Wasteland',
      kind: 'dungeon',
      done: 2,
      total: 5,
      percentage: 40,
    },
    {
      id: 'empty-zone',
      slug: 'empty-zone',
      name: 'Empty Zone',
      region: 'Hyrule',
      kind: 'zone',
      done: 0,
      total: 0,
      percentage: 0,
    },
  ]

  it('hides 100%-completed places when hideDone is true', () => {
    expect(filterPlacesForDrawer(places, 'all', false).map((p) => p.id)).toEqual([
      'kokiri-forest',
      'spirit-temple',
      'empty-zone',
    ])
    expect(filterPlacesForDrawer(places, 'all', true).map((p) => p.id)).toEqual([
      'spirit-temple',
      'empty-zone',
    ])
    expect(filterPlacesForDrawer(places, 'zones', true).map((p) => p.id)).toEqual(['empty-zone'])
  })
})
