import { dataset } from './data'
import type { Dataset } from './types'

export type CategoryProgress = {
  key: string
  name: string
  done: number
  total: number
  percentage: number
}

export type PlaceProgress = {
  id: string
  slug: string
  name: string
  kind: 'zone' | 'dungeon'
  region: string
  done: number
  total: number
  percentage: number
}

export type GlobalProgressSummary = {
  totalDone: number
  totalItems: number
  percentage: number
  completedPlaces: number
  totalPlaces: number
  categories: CategoryProgress[]
  places: PlaceProgress[]
}

function toPercentage(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

/**
 * Computes global, per-category, and per-place completion statistics from a list of collected item IDs.
 * Unknown or duplicate IDs are ignored so counts never exceed the dataset totals.
 */
export function computeGlobalProgress(
  doneIds: readonly string[],
  sourceDataset: Dataset = dataset,
): GlobalProgressSummary {
  const doneSet = new Set(doneIds)
  const categoryTotals = new Map<string, number>()
  const categoryDone = new Map<string, number>()
  const placeTotals = new Map<string, number>()
  const placeDone = new Map<string, number>()

  let totalDone = 0
  const totalItems = sourceDataset.items.length

  for (const item of sourceDataset.items) {
    incrementCount(categoryTotals, item.cat)
    incrementCount(placeTotals, item.place)

    if (doneSet.has(item.id)) {
      totalDone += 1
      incrementCount(categoryDone, item.cat)
      incrementCount(placeDone, item.place)
    }
  }

  const categories: CategoryProgress[] = sourceDataset.categories.map((category) => {
    const total = categoryTotals.get(category.key) ?? 0
    const done = categoryDone.get(category.key) ?? 0
    return {
      key: category.key,
      name: category.name,
      done,
      total,
      percentage: toPercentage(done, total),
    }
  })

  const places: PlaceProgress[] = []
  for (const place of sourceDataset.places) {
    const total = placeTotals.get(place.id) ?? 0
    if (total === 0) continue

    const done = placeDone.get(place.id) ?? 0
    places.push({
      id: place.id,
      slug: place.slug,
      name: place.name,
      kind: place.kind,
      region: place.region,
      done,
      total,
      percentage: toPercentage(done, total),
    })
  }

  const completedPlaces = places.filter((place) => place.total > 0 && place.done === place.total).length

  return {
    totalDone,
    totalItems,
    percentage: toPercentage(totalDone, totalItems),
    completedPlaces,
    totalPlaces: places.length,
    categories,
    places,
  }
}
