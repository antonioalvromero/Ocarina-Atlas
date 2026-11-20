import { itemsOfPlace } from './data'
import { meetsItemRequirements, type RequirementEvalOptions } from './prerequisites'
import type { Fraction, Item } from './types'

export const DEFAULT_NEAREST_MAX_METERS = 57
export const DEFAULT_NEAREST_MAX_DISTANCE = DEFAULT_NEAREST_MAX_METERS / 250

export type NearestCollectibleMatch = {
  item: Item
  distanceNormalized: number
  distanceMeters: number
  bearingDeg: number
}

export type FindNearestReachableCollectibleParams = {
  placeId: string | null | undefined
  mapId: string | null | undefined
  mapFraction: Fraction | null | undefined
  age: 'child' | 'adult' | null | undefined
  doneIds: ReadonlySet<string>
  ownedExpanded: ReadonlySet<string>
  beanEvalOptions?: Pick<RequirementEvalOptions, 'collectedBeanIds' | 'beanAutoSynced'>
  maxNormalizedDistance?: number
  items?: readonly Item[]
}

/**
 * Finds the nearest uncollected, age-compatible, requirement-reachable collectible
 * on the current map within `maxNormalizedDistance`.
 */
export function findNearestReachableCollectible({
  placeId,
  mapId,
  mapFraction,
  age,
  doneIds,
  ownedExpanded,
  beanEvalOptions,
  maxNormalizedDistance = DEFAULT_NEAREST_MAX_DISTANCE,
  items,
}: FindNearestReachableCollectibleParams): NearestCollectibleMatch | null {
  if (!placeId || !mapId || !mapFraction) return null
  if (!Number.isFinite(mapFraction.x) || !Number.isFinite(mapFraction.y)) return null
  if (!Number.isFinite(maxNormalizedDistance) || maxNormalizedDistance < 0) return null

  const candidates = items ?? itemsOfPlace(placeId)
  let bestItem: Item | null = null
  let bestDx = 0
  let bestDy = 0
  let bestDist = Infinity

  for (const item of candidates) {
    if (!item.at || item.at.map !== mapId) continue
    if (doneIds.has(item.id)) continue
    if (age && item.age !== null && item.age !== 'both' && item.age !== age) continue
    if (!meetsItemRequirements(item, ownedExpanded, beanEvalOptions)) continue

    const dx = item.at.x - mapFraction.x
    const dy = item.at.y - mapFraction.y
    const dist = Math.hypot(dx, dy)
    if (dist <= maxNormalizedDistance && dist < bestDist) {
      bestDist = dist
      bestItem = item
      bestDx = dx
      bestDy = dy
    }
  }

  if (!bestItem) return null

  const distanceMeters = Math.max(1, Math.round(bestDist * 250))
  if (
    maxNormalizedDistance === DEFAULT_NEAREST_MAX_DISTANCE &&
    distanceMeters > DEFAULT_NEAREST_MAX_METERS
  ) {
    return null
  }
  const bearingDeg =
    bestDx === 0 && bestDy === 0
      ? 0
      : ((Math.atan2(bestDx, -bestDy) * 180) / Math.PI + 360) % 360

  return {
    item: bestItem,
    distanceNormalized: bestDist,
    distanceMeters,
    bearingDeg,
  }
}

/**
 * Converts an absolute map bearing (0° = North, clockwise) into a bearing relative
 * to Link's current facing yaw (0° = straight ahead, 90° = to Link's right, 180° = behind).
 * Falls back to the absolute map bearing when yaw is unavailable.
 */
export function computeRelativeBearing(
  bearingDeg: number,
  playerYawDeg: number | null | undefined,
): number {
  if (typeof playerYawDeg !== 'number' || !Number.isFinite(playerYawDeg)) {
    return ((bearingDeg % 360) + 360) % 360
  }
  return (((bearingDeg - playerYawDeg) % 360) + 360) % 360
}

/**
 * Computes the next continuous rotation angle using the shortest angular delta
 * so arrows smoothly cross the 0°/360° boundary without spinning the long way around.
 */
export function stepContinuousAngle(prevDeg: number | null, targetDeg: number): number {
  if (prevDeg === null || !Number.isFinite(prevDeg)) return targetDeg
  const delta = ((((targetDeg - prevDeg) % 360) + 540) % 360) - 180
  return delta === 0 ? prevDeg : prevDeg + delta
}
