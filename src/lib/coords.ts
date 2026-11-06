import type { Fraction } from './types'

export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Box = Size & { left: number; top: number }

/**
 * The only place that maps a dataset fraction onto a box. Fractions are
 * relative to the image: origin top-left, y pointing down.
 */
export function fractionToBox(fraction: Fraction, box: Box): Point {
  return {
    x: box.left + fraction.x * box.width,
    y: box.top + fraction.y * box.height,
  }
}

/** Inverse of fractionToBox. */
export function boxToFraction(point: Point, box: Box): Fraction {
  return {
    x: (point.x - box.left) / box.width,
    y: (point.y - box.top) / box.height,
  }
}

/** CSS offsets inside a map stage, so a pin follows every zoom and resize. */
export function pinPosition(fraction: Fraction): { left: string; top: string } {
  const { x, y } = fractionToBox(fraction, { left: 0, top: 0, width: 100, height: 100 })
  return { left: `${x}%`, top: `${y}%` }
}

export function isInsideImage({ x, y }: Fraction): boolean {
  return x >= 0 && x <= 1 && y >= 0 && y <= 1
}

/** Map fraction at the centre of the viewport, and zoom relative to fit. */
export type View = { cx: number; cy: number; zoom: number }

export const INITIAL_VIEW: View = { cx: 0.5, cy: 0.5, zoom: 1 }
export const MIN_ZOOM = 1
export const MAX_ZOOM = 10

export function fitSize(container: Size, aspect: number): Size {
  const width = Math.min(container.width, container.height * aspect)
  return { width, height: width / aspect }
}

/** The stage box, in viewport pixels, for a view. */
export function stageBox(view: View, container: Size, aspect: number): Box {
  const fit = fitSize(container, aspect)
  const width = fit.width * view.zoom
  const height = fit.height * view.zoom
  return {
    width,
    height,
    left: container.width / 2 - view.cx * width,
    top: container.height / 2 - view.cy * height,
  }
}

function clampAxis(center: number, stage: number, container: number): number {
  if (stage <= container) return 0.5
  const margin = container / (2 * stage)
  return Math.min(1 - margin, Math.max(margin, center))
}

export function clampView(view: View, container: Size, aspect: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom))
  const box = stageBox({ ...view, zoom }, container, aspect)
  return {
    zoom,
    cx: clampAxis(view.cx, box.width, container.width),
    cy: clampAxis(view.cy, box.height, container.height),
  }
}

export function panView(view: View, delta: Point, container: Size, aspect: number): View {
  const box = stageBox(view, container, aspect)
  return clampView(
    { ...view, cx: view.cx - delta.x / box.width, cy: view.cy - delta.y / box.height },
    container,
    aspect,
  )
}

/** Zooms while keeping the image point under `anchor` where it is. */
export function zoomViewAt(
  view: View,
  anchor: Point,
  factor: number,
  container: Size,
  aspect: number,
): View {
  const under = boxToFraction(anchor, stageBox(view, container, aspect))
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor))
  const next = stageBox({ ...view, zoom }, container, aspect)
  return clampView(
    {
      zoom,
      cx: under.x + (container.width / 2 - anchor.x) / next.width,
      cy: under.y + (container.height / 2 - anchor.y) / next.height,
    },
    container,
    aspect,
  )
}
