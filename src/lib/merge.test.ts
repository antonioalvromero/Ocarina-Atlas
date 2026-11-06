import { describe, expect, it } from 'vitest'
import { dataset } from './data'
import { findMerge, mapDistance, MERGE_RADIUS } from './merge'
import { OTHER_PIN, PIN_TYPES } from './pinTypes'
import type { Item } from './types'

function item(id: string, cat: string, x: number, y: number, map = 'a'): Item {
  return {
    id,
    n: 1,
    cat,
    place: 'p',
    at: { map, x, y },
    name: id,
    desc: '',
    hint: null,
    age: null,
    night: false,
    requires: [],
    images: [],
  }
}

const none = new Set<string>()
const proposal = { type: 'gs', mapId: 'a', at: { x: 0.5, y: 0.5 }, aspect: 1 }

describe('mapDistance', () => {
  it('measures as a share of the long side on wide and tall maps', () => {
    expect(mapDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, 2)).toBeCloseTo(1)
    expect(mapDistance({ x: 0, y: 0 }, { x: 0, y: 1 }, 2)).toBeCloseTo(0.5)
    expect(mapDistance({ x: 0, y: 0 }, { x: 0, y: 1 }, 0.5)).toBeCloseTo(1)
    expect(mapDistance({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.5)).toBeCloseTo(0.5)
  })
})

describe('findMerge', () => {
  it('merges within the radius and not beyond it', () => {
    const inside = item('in', 'gs', 0.5 + MERGE_RADIUS - 0.001, 0.5)
    const outside = item('out', 'gs', 0.5 + MERGE_RADIUS + 0.001, 0.5)
    expect(findMerge([inside], proposal, none)).toBe(inside)
    expect(findMerge([outside], proposal, none)).toBeNull()
  })

  it('ignores other types, other floors and items with no position', () => {
    const unplaced = { ...item('u', 'gs', 0.5, 0.5), at: null }
    const items = [item('bean', 'bean', 0.5, 0.5), item('floor', 'gs', 0.5, 0.5, 'b'), unplaced]
    expect(findMerge(items, proposal, none)).toBeNull()
  })

  it('never merges an Other pin', () => {
    expect(dataset.items.some((candidate) => candidate.cat === OTHER_PIN)).toBe(false)
  })

  it('picks the nearest item', () => {
    const far = item('far', 'gs', 0.52, 0.5)
    const near = item('near', 'gs', 0.51, 0.5)
    expect(findMerge([far, near], proposal, none)).toBe(near)
  })

  it('prefers an unrevealed item, then falls back to the nearest revealed one', () => {
    const near = item('near', 'gs', 0.505, 0.5)
    const far = item('far', 'gs', 0.51, 0.5)
    expect(findMerge([near, far], proposal, new Set(['near']))).toBe(far)
    expect(findMerge([near, far], proposal, new Set(['near', 'far']))).toBe(near)
  })
})

describe('PIN_TYPES', () => {
  it('covers every official category', () => {
    const keys = PIN_TYPES.map((type) => type.key)
    for (const category of dataset.categories) expect(keys).toContain(category.key)
  })
})
