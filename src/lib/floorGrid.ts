import type { Fraction, PlaceMap } from './types'

const CELL_WIDTH = 1
const CELL_HEIGHT = 0.75
const GAP = 0.06
const LABEL_HEIGHT = 0.08

/** One floor's image, as fractions of the whole grid. */
export type FloorCell = {
  map: PlaceMap
  left: number
  top: number
  width: number
  height: number
}

export type FloorGrid = { aspect: number; cells: FloorCell[] }

function columnsFor(count: number): number {
  return count <= 3 ? count : Math.ceil(count / 2)
}

/** Lays floors out in equal cells, each image fitted whole and centred. */
export function layoutFloors(maps: PlaceMap[]): FloorGrid {
  const columns = columnsFor(maps.length)
  const rows = Math.ceil(maps.length / columns)
  const rowHeight = LABEL_HEIGHT + CELL_HEIGHT
  const totalWidth = columns * CELL_WIDTH + (columns - 1) * GAP
  const totalHeight = rows * rowHeight + (rows - 1) * GAP

  const cells = maps.map((map, index) => {
    const width = Math.min(CELL_WIDTH, CELL_HEIGHT * map.aspect)
    const height = width / map.aspect
    const x = (index % columns) * (CELL_WIDTH + GAP) + (CELL_WIDTH - width) / 2
    const y =
      Math.floor(index / columns) * (rowHeight + GAP) + LABEL_HEIGHT + (CELL_HEIGHT - height) / 2
    return {
      map,
      left: x / totalWidth,
      top: y / totalHeight,
      width: width / totalWidth,
      height: height / totalHeight,
    }
  })
  return { aspect: totalWidth / totalHeight, cells }
}

/** Converts a fraction of one floor's image to a fraction of the grid. */
export function floorToGrid(cell: FloorCell, at: Fraction): Fraction {
  return { x: cell.left + at.x * cell.width, y: cell.top + at.y * cell.height }
}

export function gridPoint(grid: FloorGrid, mapId: string, at: Fraction): Fraction | null {
  const cell = grid.cells.find((candidate) => candidate.map.id === mapId)
  return cell ? floorToGrid(cell, at) : null
}
