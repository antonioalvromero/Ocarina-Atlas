import { describe, expect, it } from 'vitest'
import {
  boxToFraction,
  clampView,
  fractionToBox,
  INITIAL_VIEW,
  isInsideImage,
  MAX_ZOOM,
  panView,
  pinPosition,
  stageBox,
  zoomViewAt,
} from './coords'

const container = { width: 800, height: 600 }
const aspect = 2

describe('fraction conversion', () => {
  const box = { left: 10, top: 20, width: 200, height: 100 }

  it('treats the origin as top-left with y pointing down', () => {
    expect(fractionToBox({ x: 0, y: 0 }, box)).toEqual({ x: 10, y: 20 })
    expect(fractionToBox({ x: 1, y: 1 }, box)).toEqual({ x: 210, y: 120 })
  })

  it('round-trips', () => {
    const fraction = { x: 0.25, y: 0.75 }
    expect(boxToFraction(fractionToBox(fraction, box), box)).toEqual(fraction)
  })

  it('produces percent offsets', () => {
    expect(pinPosition({ x: 0.25, y: 0.5 })).toEqual({ left: '25%', top: '50%' })
  })

  it('detects points outside the image', () => {
    expect(isInsideImage({ x: 0.5, y: 1 })).toBe(true)
    expect(isInsideImage({ x: -0.01, y: 0.5 })).toBe(false)
  })
})

describe('view', () => {
  it('fits and centres the stage at the initial view', () => {
    expect(stageBox(INITIAL_VIEW, container, aspect)).toEqual({
      left: 0,
      top: 100,
      width: 800,
      height: 400,
    })
  })

  it('keeps the point under the cursor fixed while zooming', () => {
    const anchor = { x: 300, y: 250 }
    const before = boxToFraction(anchor, stageBox(INITIAL_VIEW, container, aspect))
    const view = zoomViewAt(INITIAL_VIEW, anchor, 3, container, aspect)
    const after = fractionToBox(before, stageBox(view, container, aspect))
    expect(after.x).toBeCloseTo(anchor.x)
    expect(after.y).toBeCloseTo(anchor.y)
  })

  it('keeps a pin on the same image point across a resize', () => {
    const view = { cx: 0.4, cy: 0.5, zoom: 3 }
    const pin = { x: 0.4, y: 0.5 }
    for (const size of [container, { width: 1200, height: 500 }]) {
      const box = stageBox(view, size, aspect)
      expect(boxToFraction(fractionToBox(pin, box), box)).toEqual(pin)
      expect(fractionToBox(pin, box).x).toBeCloseTo(size.width / 2)
    }
  })

  it('moves with the pointer when panning', () => {
    const view = { cx: 0.5, cy: 0.5, zoom: 4 }
    const before = stageBox(view, container, aspect)
    const after = stageBox(panView(view, { x: 40, y: -30 }, container, aspect), container, aspect)
    expect(after.left - before.left).toBeCloseTo(40)
    expect(after.top - before.top).toBeCloseTo(-30)
  })

  it('keeps the map in view and limits zoom', () => {
    expect(clampView({ cx: 0.9, cy: 0.1, zoom: 1 }, container, aspect)).toEqual(INITIAL_VIEW)
    const edge = clampView({ cx: 5, cy: 0.5, zoom: 2 }, container, aspect)
    expect(stageBox(edge, container, aspect).left + 1600).toBeCloseTo(800)
    expect(clampView({ ...INITIAL_VIEW, zoom: 99 }, container, aspect).zoom).toBe(MAX_ZOOM)
  })
})
