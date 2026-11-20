import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expandOwnedRequirements } from '../lib/prerequisites'
import type { GlobalProgressSummary } from '../lib/progress-stats'
import { activeProfileSlot, read, write } from '../lib/storage'
import { translate } from '../lib/i18n'
import type { Dataset } from '../lib/types'
import { filterPlacesForDrawer, GlobalStatsDrawer, getCategoryDrawerItems } from './GlobalStatsDrawer'
import { SpoilerFreeToggle, SpoilerShieldBadgesAndHint } from './Panels'

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

  it('renders the Spoiler shield toggle button alongside Show official pins without redundant preset buttons', () => {
    const html = renderToString(
      createElement(GlobalStatsDrawer, {
        open: true,
        onClose: () => {},
        summary: emptySummary,
      }),
    )
    expect(html).not.toContain('Discovery mode')
    expect(html).not.toContain('100% Atlas mode')
    expect(html).toContain('Spoiler shield (hints first)')
    expect(html).toContain('Show official pins')
  })

  it('renders SpoilerFreeToggle and SpoilerShieldBadgesAndHint with hints, prerequisites, and hidden walkthrough notice', () => {
    const toggleHtml = renderToString(createElement(SpoilerFreeToggle, { on: true }))
    expect(toggleHtml).toContain('Spoiler shield (hints first)')
    expect(toggleHtml).toContain('role="switch"')
    expect(toggleHtml).toContain('aria-checked="true"')

    const shieldHtml = renderToString(
      createElement(SpoilerShieldBadgesAndHint, {
        item: {
          id: 'espiritu-gs-01',
          n: 1,
          cat: 'gs',
          place: 'spirit-temple',
          at: { map: 'S1', x: 0.2, y: 0.3 },
          name: 'Basement Skulltula',
          desc: 'Secret solution walkthrough paragraph that must stay hidden.',
          hint: 'Listen near the rusty grate.',
          age: 'adult',
          night: true,
          requires: ['longshot'],
          images: ['/secret-solution.webp'],
        },
        ownedExpanded: expandOwnedRequirements(['longshot']),
        onRevealSolution: () => {},
      }),
    )
    expect(shieldHtml).toContain('Gold Skulltulas')
    expect(shieldHtml).toContain('Adult')
    expect(shieldHtml).toContain('Night only')
    expect(shieldHtml).toContain('Listen near the rusty grate.')
    expect(shieldHtml).toContain('Longshot')
    expect(shieldHtml).toContain('Full walkthrough and screenshots are hidden to avoid spoilers.')
    expect(shieldHtml).toContain('Reveal full solution')
    expect(shieldHtml).not.toContain('Secret solution walkthrough paragraph that must stay hidden.')
    expect(shieldHtml).not.toContain('/secret-solution.webp')
  })

  it('renders dialog overlay marker and complete ARIA tabs semantics', () => {
    const html = renderToString(
      createElement(GlobalStatsDrawer, {
        open: true,
        onClose: () => {},
        summary: emptySummary,
      }),
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('data-overlay-open="true"')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('id="global-stats-tab-all"')
    expect(html).toContain('aria-controls="global-stats-locations-panel"')
    expect(html).toContain('id="global-stats-locations-panel"')
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('aria-labelledby="global-stats-tab-all"')
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

describe('GlobalStatsDrawer Backup & Profiles section', () => {
  const emptySummary: GlobalProgressSummary = {
    totalDone: 0,
    totalItems: 0,
    percentage: 0,
    completedPlaces: 0,
    totalPlaces: 0,
    categories: [],
    places: [],
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders Backup & Profiles controls with active profile badge, Export JSON, and Import JSON', () => {
    const html = renderToString(
      createElement(GlobalStatsDrawer, {
        open: true,
        onClose: () => {},
        summary: emptySummary,
      }),
    )

    expect(html).toContain('Backup &amp; Profiles')
    expect(html).toContain('Save profile: default')
    expect(html).toContain('Export JSON')
    expect(html).toContain('Import JSON')
    expect(html).toContain('accept="application/json,.json"')
  })

  it('displays the stored active save profile in the badge', () => {
    const entries = new Map<string, string>()
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      localStorage: {
        get length() {
          return entries.size
        },
        key: (index: number) => Array.from(entries.keys())[index] ?? null,
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
          entries.set(key, value)
        },
      },
    })

    write(activeProfileSlot, 'slot_02')
    expect(read(activeProfileSlot)).toBe('slot_02')
    expect(translate('en', 'backup.activeProfile', { profile: read(activeProfileSlot) })).toBe(
      'Save profile: slot_02',
    )

    // Server-side renderToString uses getServerSnapshot (slot.empty === 'default') for hydration safety
    const html = renderToString(
      createElement(GlobalStatsDrawer, {
        open: true,
        onClose: () => {},
        summary: emptySummary,
      }),
    )

    expect(html).toContain('Save profile: default')
  })
})
