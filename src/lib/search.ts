import { categoryName, dataset as defaultDataset, formatFloorLabel } from './data'
import {
  DEFAULT_LOCALE,
  isLocaleLoaded,
  translateCategory,
  translateItemDesc,
  translateItemHint,
  translateItemName,
  translatePlace,
  translateRegion,
  type Locale,
} from './i18n'
import type { Dataset, Place } from './types'

export type PlaceSearchResult = {
  kind: 'place'
  id: string
  slug: string
  placeKind: Place['kind']
  name: string
  region: string
  doneCount: number
  totalCount: number
  score: number
}

export type ItemSearchResult = {
  kind: 'item'
  id: string
  name: string
  placeId: string
  placeSlug: string
  placeName: string
  floor: string | null
  floorLabel: string | null
  cat: string
  categoryLabel: string
  done: boolean
  score: number
}

export type SearchResults = {
  places: PlaceSearchResult[]
  items: ItemSearchResult[]
}

export type SearchOptions = {
  locale?: Locale
  doneIds?: Iterable<string> | ReadonlySet<string>
  dataset?: Dataset
  maxPlaces?: number
  maxItems?: number
}

type IndexedPlace = {
  id: string
  slug: string
  placeKind: Place['kind']
  name: string
  region: string
  totalCount: number
  itemIds: string[]
  normName: string
  normEnglishName: string
  normRegion: string
  normEnglishRegion: string
  normSlug: string
  searchBlob: string
}

type IndexedItem = {
  id: string
  name: string
  placeId: string
  placeSlug: string
  placeName: string
  floor: string | null
  floorLabel: string | null
  cat: string
  categoryLabel: string
  normName: string
  normEnglishName: string
  normPlaceName: string
  normEnglishPlaceName: string
  normCategory: string
  normEnglishCategory: string
  normDesc: string
  normEnglishDesc: string
  normHint: string
  normEnglishHint: string
  normId: string
  searchBlob: string
}

type SearchIndex = {
  loaded: boolean
  places: IndexedPlace[]
  items: IndexedItem[]
}

const DEFAULT_MAX_PLACES = 10
const DEFAULT_MAX_ITEMS = 30

const indexCache = new WeakMap<Dataset, Map<Locale, SearchIndex>>()

/** Strips combining diacritics (NFD) and lowercases text for accent-insensitive matching. */
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function buildSearchIndex(data: Dataset, locale: Locale): SearchIndex {
  const placeMap = new Map<string, Place>()
  const itemsByPlace = new Map<string, string[]>()

  for (const place of data.places) {
    placeMap.set(place.id, place)
    itemsByPlace.set(place.id, [])
  }
  for (const item of data.items) {
    const list = itemsByPlace.get(item.place)
    if (list) list.push(item.id)
  }

  const places: IndexedPlace[] = data.places.map((place) => {
    const name = translatePlace(locale, place.id, place.name)
    const region = translateRegion(locale, place.region)
    const normName = normalizeSearchText(name)
    const normEnglishName = normalizeSearchText(place.name)
    const normRegion = normalizeSearchText(region)
    const normEnglishRegion = normalizeSearchText(place.region)
    const normSlug = normalizeSearchText(place.slug.replace(/-/g, ' '))
    const itemIds = itemsByPlace.get(place.id) ?? []

    return {
      id: place.id,
      slug: place.slug,
      placeKind: place.kind,
      name,
      region,
      totalCount: itemIds.length,
      itemIds,
      normName,
      normEnglishName,
      normRegion,
      normEnglishRegion,
      normSlug,
      searchBlob: `${normName} ${normEnglishName} ${normRegion} ${normEnglishRegion} ${normSlug}`,
    }
  })

  const items: IndexedItem[] = data.items.map((item) => {
    const place = placeMap.get(item.place)
    const englishPlaceName = place?.name ?? item.place
    const placeSlug = place?.slug ?? item.place
    const placeName = translatePlace(locale, item.place, englishPlaceName)
    const englishCategory = categoryName(item.cat)
    const categoryLabel = translateCategory(locale, item.cat, englishCategory)
    const name = translateItemName(item.id, item.name, locale)
    const desc = translateItemDesc(item.id, item.desc, locale)
    const hint = item.hint ? translateItemHint(item.id, item.hint, locale) : ''
    const floor = item.at?.map ?? null
    const floorLabel = floor && floor !== 'principal' ? formatFloorLabel(floor) : null

    const normName = normalizeSearchText(name)
    const normEnglishName = normalizeSearchText(item.name)
    const normPlaceName = normalizeSearchText(placeName)
    const normEnglishPlaceName = normalizeSearchText(englishPlaceName)
    const normCategory = normalizeSearchText(categoryLabel)
    const normEnglishCategory = normalizeSearchText(englishCategory)
    const normDesc = normalizeSearchText(desc)
    const normEnglishDesc = normalizeSearchText(item.desc)
    const normHint = hint ? normalizeSearchText(hint) : ''
    const normEnglishHint = item.hint ? normalizeSearchText(item.hint) : ''
    const normId = normalizeSearchText(item.id)

    return {
      id: item.id,
      name,
      placeId: item.place,
      placeSlug,
      placeName,
      floor,
      floorLabel,
      cat: item.cat,
      categoryLabel,
      normName,
      normEnglishName,
      normPlaceName,
      normEnglishPlaceName,
      normCategory,
      normEnglishCategory,
      normDesc,
      normEnglishDesc,
      normHint,
      normEnglishHint,
      normId,
      searchBlob: [
        normName,
        normEnglishName,
        normPlaceName,
        normEnglishPlaceName,
        normCategory,
        normEnglishCategory,
        normDesc,
        normEnglishDesc,
        normHint,
        normEnglishHint,
        normId,
      ]
        .filter(Boolean)
        .join(' '),
    }
  })

  return { loaded: isLocaleLoaded(locale), places, items }
}

function getSearchIndex(data: Dataset, locale: Locale): SearchIndex {
  let byLocale = indexCache.get(data)
  if (!byLocale) {
    byLocale = new Map()
    indexCache.set(data, byLocale)
  }
  const loadedNow = isLocaleLoaded(locale)
  let cached = byLocale.get(locale)
  if (!cached || (!cached.loaded && loadedNow)) {
    cached = buildSearchIndex(data, locale)
    byLocale.set(locale, cached)
  }
  return cached
}

function toDoneSet(doneIds?: Iterable<string> | ReadonlySet<string>): ReadonlySet<string> {
  if (!doneIds) return new Set()
  if (doneIds instanceof Set) return doneIds
  return new Set(doneIds)
}

function scorePlace(entry: IndexedPlace, query: string, tokens: string[]): number {
  for (const token of tokens) {
    if (!entry.searchBlob.includes(token)) return 0
  }

  let score = 0
  if (entry.normName === query || entry.normEnglishName === query) {
    score += 120
  } else if (entry.normName.startsWith(query) || entry.normEnglishName.startsWith(query)) {
    score += 85
  } else if (entry.normName.includes(query) || entry.normEnglishName.includes(query)) {
    score += 55
  }

  if (entry.normRegion.includes(query) || entry.normEnglishRegion.includes(query)) {
    score += 25
  }
  if (entry.normSlug.includes(query)) {
    score += 20
  }

  for (const token of tokens) {
    if (entry.normName.startsWith(token) || entry.normEnglishName.startsWith(token)) {
      score += 15
    } else if (entry.normName.includes(token) || entry.normEnglishName.includes(token)) {
      score += 10
    } else if (entry.normRegion.includes(token) || entry.normEnglishRegion.includes(token)) {
      score += 5
    } else {
      score += 2
    }
  }

  return score
}

function scoreItem(entry: IndexedItem, query: string, tokens: string[]): number {
  for (const token of tokens) {
    if (!entry.searchBlob.includes(token)) return 0
  }

  let score = 0
  if (entry.normName === query || entry.normEnglishName === query || entry.normId === query) {
    score += 120
  } else if (entry.normName.startsWith(query) || entry.normEnglishName.startsWith(query)) {
    score += 80
  } else if (entry.normName.includes(query) || entry.normEnglishName.includes(query)) {
    score += 50
  }

  if (entry.normCategory.includes(query) || entry.normEnglishCategory.includes(query)) {
    score += 30
  }
  if (entry.normPlaceName.includes(query) || entry.normEnglishPlaceName.includes(query)) {
    score += 25
  }
  if (entry.normDesc.includes(query) || entry.normEnglishDesc.includes(query)) {
    score += 12
  }
  if (entry.normHint.includes(query) || entry.normEnglishHint.includes(query)) {
    score += 10
  }

  for (const token of tokens) {
    if (entry.normName.startsWith(token) || entry.normEnglishName.startsWith(token)) {
      score += 14
    } else if (entry.normName.includes(token) || entry.normEnglishName.includes(token)) {
      score += 9
    } else if (entry.normCategory.includes(token) || entry.normEnglishCategory.includes(token)) {
      score += 6
    } else if (entry.normPlaceName.includes(token) || entry.normEnglishPlaceName.includes(token)) {
      score += 5
    } else {
      score += 2
    }
  }

  return score
}

/**
 * Searches all places and collectibles with accent-insensitive, multi-token matching
 * across both the active locale and English fallback text.
 */
export function searchAtlas(query: string, options: SearchOptions = {}): SearchResults {
  const normalizedQuery = normalizeSearchText(query)
  if (!normalizedQuery) {
    return { places: [], items: [] }
  }

  const locale = options.locale ?? DEFAULT_LOCALE
  const data = options.dataset ?? defaultDataset
  const maxPlaces = options.maxPlaces ?? DEFAULT_MAX_PLACES
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS
  const doneSet = toDoneSet(options.doneIds)
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const index = getSearchIndex(data, locale)

  const places: PlaceSearchResult[] = []
  for (const entry of index.places) {
    const score = scorePlace(entry, normalizedQuery, tokens)
    if (score <= 0) continue
    let doneCount = 0
    if (doneSet.size > 0) {
      for (const itemId of entry.itemIds) {
        if (doneSet.has(itemId)) doneCount += 1
      }
    }
    places.push({
      kind: 'place',
      id: entry.id,
      slug: entry.slug,
      placeKind: entry.placeKind,
      name: entry.name,
      region: entry.region,
      doneCount,
      totalCount: entry.totalCount,
      score,
    })
  }
  places.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

  const items: ItemSearchResult[] = []
  for (const entry of index.items) {
    const score = scoreItem(entry, normalizedQuery, tokens)
    if (score <= 0) continue
    items.push({
      kind: 'item',
      id: entry.id,
      name: entry.name,
      placeId: entry.placeId,
      placeSlug: entry.placeSlug,
      placeName: entry.placeName,
      floor: entry.floor,
      floorLabel: entry.floorLabel,
      cat: entry.cat,
      categoryLabel: entry.categoryLabel,
      done: doneSet.has(entry.id),
      score,
    })
  }
  items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

  return {
    places: places.slice(0, maxPlaces),
    items: items.slice(0, maxItems),
  }
}

/** Returns all places in dataset order for quick browsing when the search query is empty. */
export function getQuickBrowsePlaces(options: SearchOptions = {}): PlaceSearchResult[] {
  const locale = options.locale ?? DEFAULT_LOCALE
  const data = options.dataset ?? defaultDataset
  const maxPlaces = options.maxPlaces ?? data.places.length
  const doneSet = toDoneSet(options.doneIds)
  const index = getSearchIndex(data, locale)

  return index.places.slice(0, maxPlaces).map((entry) => {
    let doneCount = 0
    if (doneSet.size > 0) {
      for (const itemId of entry.itemIds) {
        if (doneSet.has(itemId)) doneCount += 1
      }
    }
    return {
      kind: 'place',
      id: entry.id,
      slug: entry.slug,
      placeKind: entry.placeKind,
      name: entry.name,
      region: entry.region,
      doneCount,
      totalCount: entry.totalCount,
      score: 0,
    }
  })
}
