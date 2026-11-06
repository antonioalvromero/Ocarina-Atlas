import raw from '../data/oot.json'
import type { Dataset, Item, ItemRequirement, Place, PlaceMap } from './types'

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

export function categoryName(key: string): string {
  return categoryNames.get(key) ?? key
}

export function requirementLabel(requirement: ItemRequirement): string {
  const keys = typeof requirement === 'string' ? [requirement] : requirement
  return keys.map((key) => requirementNames.get(key) ?? key).join(' or ')
}
