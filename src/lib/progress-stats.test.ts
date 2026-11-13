import { describe, expect, it } from 'vitest'
import { dataset } from './data'
import { computeGlobalProgress } from './progress-stats'
import type { Dataset } from './types'

describe('computeGlobalProgress', () => {
  it('computes empty progress with category totals summing to 184', () => {
    const summary = computeGlobalProgress([])

    expect(summary.totalDone).toBe(0)
    expect(summary.totalItems).toBe(184)
    expect(summary.percentage).toBe(0)
    expect(summary.completedPlaces).toBe(0)
    expect(summary.totalPlaces).toBe(summary.places.length)
    expect(summary.totalPlaces).toBeGreaterThan(0)

    expect(summary.categories.map((c) => c.key)).toEqual(dataset.categories.map((c) => c.key))
    const categoryTotalSum = summary.categories.reduce((sum, category) => sum + category.total, 0)
    expect(categoryTotalSum).toBe(184)

    for (const category of summary.categories) {
      expect(category.done).toBe(0)
      expect(category.percentage).toBe(0)
    }

    for (const place of summary.places) {
      expect(place.total).toBeGreaterThan(0)
      expect(place.done).toBe(0)
      expect(place.percentage).toBe(0)
    }
  })

  it('computes partial progress and completedPlaces accurately', () => {
    const kokiriItems = dataset.items.filter((item) => item.place === 'kokiri')
    const dekuItems = dataset.items.filter((item) => item.place === 'deku')
    expect(kokiriItems.length).toBeGreaterThan(0)
    expect(dekuItems.length).toBeGreaterThan(1)

    const doneIds = [...kokiriItems.map((item) => item.id), dekuItems[0]!.id]
    const summary = computeGlobalProgress(doneIds)

    expect(summary.totalDone).toBe(doneIds.length)
    expect(summary.totalItems).toBe(184)
    expect(summary.percentage).toBe(Math.round((doneIds.length / 184) * 100))
    expect(summary.completedPlaces).toBe(1)

    const kokiriProgress = summary.places.find((place) => place.id === 'kokiri')
    expect(kokiriProgress).toBeDefined()
    expect(kokiriProgress?.done).toBe(kokiriItems.length)
    expect(kokiriProgress?.total).toBe(kokiriItems.length)
    expect(kokiriProgress?.percentage).toBe(100)

    const dekuProgress = summary.places.find((place) => place.id === 'deku')
    expect(dekuProgress).toBeDefined()
    expect(dekuProgress?.done).toBe(1)
    expect(dekuProgress?.total).toBe(dekuItems.length)
    expect(dekuProgress?.percentage).toBe(Math.round((1 / dekuItems.length) * 100))

    const categoryDoneSum = summary.categories.reduce((sum, category) => sum + category.done, 0)
    expect(categoryDoneSum).toBe(doneIds.length)
  })

  it('deduplicates doneIds and ignores unknown or stale IDs', () => {
    const sampleItem = dataset.items[0]!
    const secondItem = dataset.items[1]!

    const summary = computeGlobalProgress([
      sampleItem.id,
      sampleItem.id,
      secondItem.id,
      'unknown-stale-id',
      'kokiri-999',
      '',
    ])

    expect(summary.totalDone).toBe(2)
    expect(summary.totalItems).toBe(184)
    expect(summary.categories.reduce((sum, c) => sum + c.done, 0)).toBe(2)
    expect(summary.places.reduce((sum, p) => sum + p.done, 0)).toBe(2)
  })

  it('computes 100% completion across all items, categories, and places', () => {
    const allIds = dataset.items.map((item) => item.id)
    const summary = computeGlobalProgress(allIds)

    expect(summary.totalDone).toBe(184)
    expect(summary.totalItems).toBe(184)
    expect(summary.percentage).toBe(100)
    expect(summary.completedPlaces).toBe(summary.totalPlaces)

    for (const category of summary.categories) {
      expect(category.done).toBe(category.total)
      if (category.total > 0) {
        expect(category.percentage).toBe(100)
      }
    }

    for (const place of summary.places) {
      expect(place.done).toBe(place.total)
      expect(place.percentage).toBe(100)
    }
  })

  it('handles custom datasets with empty places and zero items safely', () => {
    const customDataset: Dataset = {
      map: { image: 'map.png', width: 100, height: 100 },
      categories: [
        { key: 'gs', name: 'Gold Skulltulas' },
        { key: 'hc', name: 'Heart Containers' },
      ],
      requirements: [],
      places: [
        {
          id: 'empty-zone',
          slug: 'empty-zone',
          kind: 'zone',
          name: 'Empty Zone',
          region: 'Hyrule',
          intro: '',
          pin: { x: 0.5, y: 0.5 },
          maps: [],
          startMap: null,
        },
        {
          id: 'dungeon-1',
          slug: 'dungeon-1',
          kind: 'dungeon',
          name: 'Dungeon 1',
          region: 'Hyrule',
          intro: '',
          pin: { x: 0.2, y: 0.2 },
          maps: [],
          startMap: null,
        },
      ],
      items: [
        {
          id: 'item-1',
          n: 1,
          cat: 'gs',
          place: 'dungeon-1',
          at: null,
          name: 'Skulltula 1',
          desc: '',
          hint: null,
          age: null,
          night: false,
          requires: [],
          images: [],
        },
      ],
    }

    const summary = computeGlobalProgress(['item-1', 'stale'], customDataset)
    expect(summary.totalDone).toBe(1)
    expect(summary.totalItems).toBe(1)
    expect(summary.percentage).toBe(100)
    expect(summary.totalPlaces).toBe(1)
    expect(summary.completedPlaces).toBe(1)
    expect(summary.places.map((p) => p.id)).toEqual(['dungeon-1'])
    expect(summary.categories).toEqual([
      { key: 'gs', name: 'Gold Skulltulas', done: 1, total: 1, percentage: 100 },
      { key: 'hc', name: 'Heart Containers', done: 0, total: 0, percentage: 0 },
    ])

    const emptySummary = computeGlobalProgress(['item-1'], { ...customDataset, items: [] })
    expect(emptySummary.totalDone).toBe(0)
    expect(emptySummary.totalItems).toBe(0)
    expect(emptySummary.percentage).toBe(0)
    expect(emptySummary.totalPlaces).toBe(0)
    expect(emptySummary.completedPlaces).toBe(0)
  })
})
