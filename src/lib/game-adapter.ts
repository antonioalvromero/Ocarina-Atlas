import rawOot from '../data/oot.json'
import type { Dataset, Item, Place } from './types'

export type GameAdapterConfig = {
  id: string
  titleIds: readonly string[]
  displayName: string
  storagePrefix: string
  dataset: Dataset
}

export interface GameAdapter {
  readonly id: string
  readonly titleIds: readonly string[]
  readonly displayName: string
  readonly storagePrefix: string
  readonly dataset: Dataset
  readonly totalCollectibles: number
  getPlaceById(id: string): Place | undefined
  getPlaceBySlug(slug: string): Place | undefined
  itemsOfPlace(placeId: string): Item[]
}

/**
 * Builds an indexed `GameAdapter` instance from a static `Dataset` configuration.
 * Pre-indexes places by ID and slug and items by place ID for O(1) lookups.
 */
export function createGameAdapter(config: GameAdapterConfig): GameAdapter {
  const placeByIdMap = new Map<string, Place>()
  const placeBySlugMap = new Map<string, Place>()
  const itemsByPlaceMap = new Map<string, Item[]>()

  for (const place of config.dataset.places) {
    placeByIdMap.set(place.id, place)
    placeBySlugMap.set(place.slug, place)
  }

  for (const item of config.dataset.items) {
    const existing = itemsByPlaceMap.get(item.place)
    if (existing) {
      existing.push(item)
    } else {
      itemsByPlaceMap.set(item.place, [item])
    }
  }

  const normalizedTitleIds = Object.freeze(
    config.titleIds.map((titleId) => titleId.trim().toUpperCase()),
  )

  return {
    id: config.id,
    titleIds: normalizedTitleIds,
    displayName: config.displayName,
    storagePrefix: config.storagePrefix,
    dataset: config.dataset,
    totalCollectibles: config.dataset.items.length,
    getPlaceById(id: string): Place | undefined {
      return placeByIdMap.get(id)
    },
    getPlaceBySlug(slug: string): Place | undefined {
      return placeBySlugMap.get(slug)
    },
    itemsOfPlace(placeId: string): Item[] {
      return itemsByPlaceMap.get(placeId) ?? []
    },
  }
}

export const OOT_REMAKE_DATASET = rawOot as unknown as Dataset

export const OOT_REMAKE_ADAPTER: GameAdapter = createGameAdapter({
  id: 'oot-remake',
  titleIds: ['0400486024DEC000'],
  displayName: 'The Legend of Zelda: Ocarina of Time Remake',
  storagePrefix: 'oot-map:v1:',
  dataset: OOT_REMAKE_DATASET,
})

const adapterRegistry = new Map<string, GameAdapter>([[OOT_REMAKE_ADAPTER.id, OOT_REMAKE_ADAPTER]])
let activeAdapterId: string = OOT_REMAKE_ADAPTER.id

/** Registers (or replaces) a `GameAdapter` in the global adapter registry. */
export function registerGameAdapter(adapter: GameAdapter): GameAdapter {
  if (!adapter || typeof adapter.id !== 'string' || adapter.id.trim().length === 0) {
    throw new Error('GameAdapter must have a non-empty string id.')
  }
  adapterRegistry.set(adapter.id, adapter)
  return adapter
}

/** Looks up a registered `GameAdapter` by its `id`. */
export function getGameAdapter(id: string): GameAdapter | undefined {
  return adapterRegistry.get(id)
}

/** Looks up a registered `GameAdapter` matching a Switch/recomp title ID (case-insensitive). */
export function findGameAdapterByTitleId(titleId: string): GameAdapter | undefined {
  const normalized = titleId.trim().toUpperCase()
  if (!normalized) return undefined
  for (const adapter of adapterRegistry.values()) {
    if (adapter.titleIds.some((t) => t.toUpperCase() === normalized)) {
      return adapter
    }
  }
  return undefined
}

/** Returns the currently active `GameAdapter` (defaults to `OOT_REMAKE_ADAPTER`). */
export function getActiveGameAdapter(): GameAdapter {
  return adapterRegistry.get(activeAdapterId) ?? OOT_REMAKE_ADAPTER
}

/** Switches the active `GameAdapter` to a previously registered adapter ID. */
export function setActiveGameAdapter(id: string): GameAdapter {
  const next = adapterRegistry.get(id)
  if (!next) {
    throw new Error(`Unknown GameAdapter "${id}". Register it with registerGameAdapter() first.`)
  }
  activeAdapterId = id
  return next
}

/** Lists all currently registered `GameAdapter` instances. */
export function listGameAdapters(): GameAdapter[] {
  return Array.from(adapterRegistry.values())
}

/** Resets the adapter registry back to the default `OOT_REMAKE_ADAPTER` for isolated unit tests. */
export function resetGameAdaptersForTests(): void {
  adapterRegistry.clear()
  adapterRegistry.set(OOT_REMAKE_ADAPTER.id, OOT_REMAKE_ADAPTER)
  activeAdapterId = OOT_REMAKE_ADAPTER.id
}
