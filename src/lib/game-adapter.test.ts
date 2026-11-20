import { afterEach, describe, expect, it } from 'vitest'
import esGuide from '../data/i18n/es.json'
import frGuide from '../data/i18n/fr.json'
import ptGuide from '../data/i18n/pt.json'
import {
  categoryName,
  dataset,
  findPlace,
  formatFloorLabel,
  itemsOfPlace,
  placeById,
  placeBySlug,
  requirementLabel,
} from './data'
import {
  OOT_REMAKE_ADAPTER,
  createGameAdapter,
  findGameAdapterByTitleId,
  getActiveGameAdapter,
  getGameAdapter,
  listGameAdapters,
  registerGameAdapter,
  resetGameAdaptersForTests,
  setActiveGameAdapter,
} from './game-adapter'
import { hasBalancedBoldMarkers, validateGuideTranslation } from './guide-schema'
import type { Dataset } from './types'

const MINI_DATASET: Dataset = {
  map: { image: '/maps/test-world.webp', width: 1000, height: 1000 },
  categories: [{ key: 'gs', name: 'Gold Skulltulas' }],
  requirements: [{ key: 'bombs', name: 'Bombs' }],
  places: [
    {
      id: 'clock-town',
      slug: 'clock-town',
      kind: 'zone',
      name: 'Clock Town',
      region: 'Termina',
      intro: 'Three days in Clock Town.',
      pin: { x: 0.5, y: 0.5 },
      maps: [{ id: 'principal', label: 'Main', image: '/maps/clock-town.webp', aspect: 1 }],
      startMap: 'principal',
    },
  ],
  items: [
    {
      id: 'clock-gs-01',
      n: 1,
      cat: 'gs',
      place: 'clock-town',
      at: { map: 'principal', x: 0.25, y: 0.75 },
      name: 'East Clock Town chest',
      desc: 'Use **Bombs** near the wall.',
      hint: 'Check the east alley.',
      age: 'child',
      night: false,
      requires: ['bombs'],
      images: [],
    },
    {
      id: 'clock-gs-02',
      n: 2,
      cat: 'gs',
      place: 'clock-town',
      at: { map: 'principal', x: 0.75, y: 0.25 },
      name: 'Laundry Pool crate',
      desc: 'Roll into the crate.',
      hint: null,
      age: null,
      night: true,
      requires: [],
      images: [],
    },
  ],
}

afterEach(() => {
  resetGameAdaptersForTests()
})

describe('OOT_REMAKE_ADAPTER and data.ts delegation', () => {
  it('exposes the Ocarina of Time Remake adapter with 32 places and 184 collectibles', () => {
    expect(OOT_REMAKE_ADAPTER.id).toBe('oot-remake')
    expect(OOT_REMAKE_ADAPTER.titleIds).toEqual(['0400486024DEC000'])
    expect(OOT_REMAKE_ADAPTER.storagePrefix).toBe('oot-map:v1:')
    expect(OOT_REMAKE_ADAPTER.totalCollectibles).toBe(184)
    expect(OOT_REMAKE_ADAPTER.dataset.places).toHaveLength(32)
    expect(OOT_REMAKE_ADAPTER.dataset.items).toHaveLength(184)
  })

  it('indexes places by ID and slug and items by place ID', () => {
    const kokiriById = OOT_REMAKE_ADAPTER.getPlaceById('kokiri')
    expect(kokiriById?.name).toBe('Kokiri Forest')
    const kokiriBySlug = OOT_REMAKE_ADAPTER.getPlaceBySlug(kokiriById!.slug)
    expect(kokiriBySlug).toBe(kokiriById)
    expect(OOT_REMAKE_ADAPTER.getPlaceById('nonexistent')).toBeUndefined()
    expect(OOT_REMAKE_ADAPTER.getPlaceBySlug('nonexistent')).toBeUndefined()

    const kokiriItems = OOT_REMAKE_ADAPTER.itemsOfPlace('kokiri')
    expect(kokiriItems.length).toBeGreaterThan(0)
    expect(kokiriItems.every((item) => item.place === 'kokiri')).toBe(true)
    expect(OOT_REMAKE_ADAPTER.itemsOfPlace('nonexistent')).toEqual([])
  })

  it('keeps data.ts helpers 100% backwards-compatible while delegating to OOT_REMAKE_ADAPTER', () => {
    expect(dataset).toBe(OOT_REMAKE_ADAPTER.dataset)
    const kokiri = placeById('kokiri')
    expect(kokiri).toBeDefined()
    expect(placeBySlug(kokiri!.slug)).toBe(kokiri)
    expect(findPlace(kokiri!.slug)).toBe(kokiri)
    expect(itemsOfPlace('kokiri')).toEqual(OOT_REMAKE_ADAPTER.itemsOfPlace('kokiri'))
    expect(categoryName('gs')).toBe('Gold Skulltulas')
    expect(requirementLabel(['bombs', 'megaton-hammer'])).toBe('Bombs or Megaton Hammer')
    expect(formatFloorLabel('S1')).toBe('B1')
    expect(formatFloorLabel('principal')).toBe('Main')
  })
})

describe('GameAdapter registry', () => {
  it('defaults to OOT_REMAKE_ADAPTER and supports registering and activating custom adapters', () => {
    expect(getActiveGameAdapter()).toBe(OOT_REMAKE_ADAPTER)
    expect(getGameAdapter('oot-remake')).toBe(OOT_REMAKE_ADAPTER)
    expect(findGameAdapterByTitleId('0400486024dec000')).toBe(OOT_REMAKE_ADAPTER)

    const mmAdapter = createGameAdapter({
      id: 'mm-remake',
      titleIds: ['0400486024DEC999'],
      displayName: "The Legend of Zelda: Majora's Mask",
      storagePrefix: 'mm-map:v1:',
      dataset: MINI_DATASET,
    })

    registerGameAdapter(mmAdapter)
    expect(getGameAdapter('mm-remake')).toBe(mmAdapter)
    expect(findGameAdapterByTitleId('0400486024dec999')).toBe(mmAdapter)
    expect(listGameAdapters().map((a) => a.id)).toEqual(['oot-remake', 'mm-remake'])

    setActiveGameAdapter('mm-remake')
    expect(getActiveGameAdapter()).toBe(mmAdapter)
    expect(getActiveGameAdapter().totalCollectibles).toBe(2)
    expect(getActiveGameAdapter().getPlaceById('clock-town')?.name).toBe('Clock Town')
    expect(getActiveGameAdapter().itemsOfPlace('clock-town')).toHaveLength(2)
  })

  it('rejects invalid adapter registration or unknown active adapter IDs', () => {
    expect(() =>
      registerGameAdapter({
        ...OOT_REMAKE_ADAPTER,
        id: '   ',
      }),
    ).toThrow(/non-empty string id/)
    expect(() => setActiveGameAdapter('unknown-game')).toThrow(/Unknown GameAdapter/)
    expect(findGameAdapterByTitleId('')).toBeUndefined()
    expect(findGameAdapterByTitleId('0000000000000000')).toBeUndefined()
  })
})

describe('validateGuideTranslation and hasBalancedBoldMarkers', () => {
  it('validates balanced ** bold markdown markers', () => {
    expect(hasBalancedBoldMarkers('Plain text without bold.')).toBe(true)
    expect(hasBalancedBoldMarkers('Use **Bombs** or **Hookshot** here.')).toBe(true)
    expect(hasBalancedBoldMarkers('Unclosed **bold phrase here.')).toBe(false)
    expect(hasBalancedBoldMarkers('Empty **** bold span.')).toBe(false)
  })

  it('passes validation for bundled es, fr, and pt guide translation files against OOT_REMAKE_ADAPTER.dataset', () => {
    for (const [locale, guide] of [
      ['es', esGuide],
      ['fr', frGuide],
      ['pt', ptGuide],
    ] as const) {
      const result = validateGuideTranslation(guide, OOT_REMAKE_ADAPTER.dataset)
      expect(result.errors, `Unexpected validation errors in ${locale}.json`).toEqual([])
      expect(result.valid).toBe(true)
    }
  })

  it('validates a complete custom guide translation against MINI_DATASET', () => {
    const validGuide = {
      places: {
        'clock-town': {
          intro: 'Welcome to **Clock Town**.',
        },
      },
      items: {
        'clock-gs-01': {
          name: 'East Clock Town chest',
          desc: 'Blast the wall with **Bombs**.',
          hint: 'Look in the east alley.',
        },
        'clock-gs-02': {
          name: 'Laundry Pool crate',
          desc: 'Roll into the wooden crate at night.',
        },
      },
    }

    expect(validateGuideTranslation(validGuide, MINI_DATASET)).toEqual({
      valid: true,
      errors: [],
    })
  })

  it('reports descriptive errors for non-object roots, unexpected keys, missing entries, hint mismatches, and unbalanced bold markers', () => {
    expect(validateGuideTranslation(null, MINI_DATASET).valid).toBe(false)
    expect(validateGuideTranslation([], MINI_DATASET).valid).toBe(false)
    expect(validateGuideTranslation({ extra: true }, MINI_DATASET).errors).toContain(
      'Unexpected top-level key "extra". Expected only "places" and "items".',
    )

    const brokenGuide = {
      places: {
        'clock-town': {
          intro: 'Unbalanced **bold intro',
          extraKey: 'bad',
        },
        'unknown-place': {
          intro: 'Should not exist',
        },
      },
      items: {
        'clock-gs-01': {
          name: '   ',
          desc: 'Unbalanced **bold desc',
          // missing required hint!
        },
        'clock-gs-02': {
          name: 'Laundry Pool crate',
          desc: 'Roll into crate.',
          hint: 'Unexpected hint where dataset has null',
          extraField: 123,
        },
        'unknown-item': {
          name: 'Ghost',
          desc: 'Not in dataset',
        },
      },
    }

    const res = validateGuideTranslation(brokenGuide, MINI_DATASET)
    expect(res.valid).toBe(false)
    expect(res.errors).toEqual(
      expect.arrayContaining([
        'places.clock-town: unexpected key "extraKey".',
        'places.clock-town.intro: unbalanced "**" bold markdown markers.',
        'places.unknown-place: unknown place ID not present in dataset.',
        'items.clock-gs-01.name: must be a non-empty string.',
        'items.clock-gs-01.desc: unbalanced "**" bold markdown markers.',
        'items.clock-gs-01.hint: must be a non-empty string (dataset item has a hint).',
        'items.clock-gs-02: unexpected key "extraField".',
        'items.clock-gs-02.hint: unexpected hint translation (dataset item has hint: null).',
        'items.unknown-item: unknown item ID not present in dataset.',
      ]),
    )
  })
})
