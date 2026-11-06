import { describe, expect, it } from 'vitest'
import { floorToGrid, gridPoint, layoutFloors } from './floorGrid'
import type { PlaceMap } from './types'

const floor = (id: string, aspect: number): PlaceMap => ({ id, label: id, image: `/${id}.svg`, aspect })

describe('layoutFloors', () => {
  const maps = [floor('a', 2.3), floor('b', 1.9), floor('c', 0.7), floor('d', 1.3), floor('e', 0.55)]
  const grid = layoutFloors(maps)

  it('keeps every floor inside the grid', () => {
    for (const cell of grid.cells) {
      expect(cell.left).toBeGreaterThanOrEqual(0)
      expect(cell.top).toBeGreaterThanOrEqual(0)
      expect(cell.left + cell.width).toBeLessThanOrEqual(1)
      expect(cell.top + cell.height).toBeLessThanOrEqual(1)
    }
  })

  it('preserves each image aspect ratio', () => {
    for (const cell of grid.cells) {
      expect((cell.width * grid.aspect) / cell.height).toBeCloseTo(cell.map.aspect)
    }
  })

  it('never overlaps floors', () => {
    const a = grid.cells[0]!
    const b = grid.cells[1]!
    expect(a.left + a.width).toBeLessThanOrEqual(b.left)
  })

  it('uses one row for up to three floors', () => {
    const tops = layoutFloors(maps.slice(0, 3)).cells.map((cell) => cell.top + cell.height / 2)
    expect(tops[0]).toBeCloseTo(tops[1]!)
    expect(tops[1]).toBeCloseTo(tops[2]!)
  })
})

describe('floorToGrid', () => {
  const grid = layoutFloors([floor('a', 1), floor('b', 2)])

  it('maps floor corners onto the cell corners', () => {
    const cell = grid.cells[1]!
    expect(floorToGrid(cell, { x: 0, y: 0 })).toEqual({ x: cell.left, y: cell.top })
    expect(floorToGrid(cell, { x: 1, y: 1 }).x).toBeCloseTo(cell.left + cell.width)
  })

  it('returns null for an unknown floor', () => {
    expect(gridPoint(grid, 'nope', { x: 0, y: 0 })).toBeNull()
  })
})
