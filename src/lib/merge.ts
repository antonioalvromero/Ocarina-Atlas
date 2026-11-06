import type { AgeFilter, Fraction, Item } from './types'

/** How close a pin must be to an official item, as a share of the map's long side. */
export const MERGE_RADIUS = 0.03

/** A pin that became an official item, kept for the animation and for undo. */
export type Merge = {
  id: number
  item: Item
  mapId: string
  type: string
  name: string
  from: Fraction
  to: Fraction
  /** The official pin was not on screen before this merge. */
  appeared: boolean
  /** This merge added the item to the revealed list. */
  revealed: boolean
  /** This merge turned its category filter back on. */
  unhid: boolean
  /** The age filter this merge widened to show the item, if any. */
  previousAge: AgeFilter | null
}

export type Proposal = { type: string; mapId: string; at: Fraction; aspect: number }

/** Distance on a map of `aspect` (width / height), as a share of its long side. */
export function mapDistance(a: Fraction, b: Fraction, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y) / Math.max(aspect, 1)
}

/**
 * The official item a new pin stands for: same type, same map, within reach.
 * Unrevealed items win, so a second pin on a shared spot finds the second item.
 */
export function findMerge(items: Item[], proposal: Proposal, revealed: ReadonlySet<string>): Item | null {
  const { type, mapId, at, aspect } = proposal
  const nearby = items
    .flatMap((item) => {
      if (item.cat !== type || item.at?.map !== mapId) return []
      const distance = mapDistance(at, item.at, aspect)
      return distance <= MERGE_RADIUS ? [{ item, distance }] : []
    })
    .sort((a, b) => a.distance - b.distance)
    .map(({ item }) => item)
  return nearby.find((item) => !revealed.has(item.id)) ?? nearby[0] ?? null
}
