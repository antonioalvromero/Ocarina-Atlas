import raw from '../data/oot.json'
import type { AgeFilter, Dataset, Item, ItemRequirement, Place, PlaceMap } from './types'

export const dataset = raw as unknown as Dataset

const requirementNames = new Map(dataset.requirements.map((r) => [r.key, r.name]))
const categoryNames = new Map(dataset.categories.map((c) => [c.key, c.name]))

export function findPlace(slug: string): Place | undefined {
  return dataset.places.find((place) => place.slug === slug)
}

export function itemsOfPlace(placeId: string): Item[] {
  return dataset.items.filter((item) => item.place === placeId)
}

export function startMapOf(place: Place): PlaceMap | undefined {
  return place.maps.find((map) => map.id === place.startMap) ?? place.maps[0]
}

/** Items that cannot be drawn on one of the place's maps. */
export function isUnplaced(item: Item, place: Place): boolean {
  const at = item.at
  return at === null || !place.maps.some((map) => map.id === at.map)
}

/** Items with no recorded age stay visible, since they may be reachable at either age. */
export function matchesAge(item: Item, filter: AgeFilter): boolean {
  return filter === 'both' || item.age === null || item.age === 'both' || item.age === filter
}

export function categoryName(key: string): string {
  return categoryNames.get(key) ?? key
}

export function requirementLabel(requirement: ItemRequirement): string {
  const keys = typeof requirement === 'string' ? [requirement] : requirement
  return keys.map((key) => requirementNames.get(key) ?? key).join(' or ')
}

const FLOOR_DISPLAY_LABELS: Record<string, string> = {
  '1F': '1F',
  '2F': '2F',
  '3F': '3F',
  '4F': '4F',
  '5F': '5F',
  S1: 'B1',
  B1: 'B1',
  S2: 'B2',
  B2: 'B2',
  S3: 'B3',
  B3: 'B3',
  S4: 'B4',
  B4: 'B4',
  nino: 'Child',
  adulto: 'Adult',
  principal: 'Main',
}

/** Normalizes a floor label or internal map ID (`S1`-`S4`, `nino`, `adulto`, `principal`) to a standard English display label. */
export function formatFloorLabel(labelOrId: string): string {
  return FLOOR_DISPLAY_LABELS[labelOrId] ?? labelOrId
}
