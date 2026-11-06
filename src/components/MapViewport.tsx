import { Minus, Plus, Scan } from 'lucide-react'
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react'
import {
  boxToFraction,
  clampView,
  fractionToBox,
  INITIAL_VIEW,
  isInsideImage,
  MAX_ZOOM,
  MIN_ZOOM,
  panView,
  stageBox,
  zoomViewAt,
  type Point,
  type Size,
} from '../lib/coords'
import { read, viewSlot, write } from '../lib/storage'
import type { Fraction } from '../lib/types'

const DRAG_THRESHOLD = 4
const KEY_PAN = 80
const BUTTON_ZOOM = 1.5
/** Wheel and drag change the view on every event, so saving waits for a pause. */
const SAVE_DELAY = 200

export type MapViewportHandle = { centerOn: (fraction: Fraction) => void }

export type Projection = { size: Size; project: (fraction: Fraction) => Point }

type Props = {
  /** Identifies this map's saved zoom and position. */
  viewId: string
  /** Omit when the children draw the whole stage. */
  image?: string
  alt: string
  aspect: number
  ref?: Ref<MapViewportHandle>
  /** A click on the image that was neither a drag nor on a `data-pin` element. */
  onMapClick?: (fraction: Fraction) => void
  /** Pins, laid out in the stage: 0-100% of the image. */
  children?: ReactNode
  /** UI over the map that must not move or zoom with it. */
  overlay?: (projection: Projection) => ReactNode
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function MapViewport({ viewId, image, alt, aspect, ref, onMapClick, children, overlay }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [view, setView] = useState(INITIAL_VIEW)

  const pointers = useRef(new Map<number, Point>())
  const pressStart = useRef<Point>({ x: 0, y: 0 })
  const dragged = useRef(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () =>
      setSize({ width: container.clientWidth, height: container.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // After mount, so hydration matches the server, which has no saved view.
  useLayoutEffect(() => setView(read(viewSlot(viewId))), [viewId])

  useEffect(() => {
    const timer = setTimeout(() => write(viewSlot(viewId), view), SAVE_DELAY)
    return () => clearTimeout(timer)
  }, [viewId, view])

  const shown = size ? clampView(view, size, aspect) : view
  const box = size ? stageBox(shown, size, aspect) : null

  useImperativeHandle(
    ref,
    () => ({ centerOn: ({ x, y }) => setView((v) => ({ ...v, cx: x, cy: y })) }),
    [],
  )

  // React attaches wheel listeners passively, which cannot prevent page zoom.
  useEffect(() => {
    const container = containerRef.current
    if (!container || !size) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = container.getBoundingClientRect()
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
      const speed = event.ctrlKey ? 0.01 : 0.002
      const factor = Math.exp(-event.deltaY * lines * speed)
      setView((v) => zoomViewAt(clampView(v, size, aspect), anchor, factor, size, aspect))
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [size, aspect])

  function localPoint(event: { clientX: number; clientY: number }): Point {
    const rect = containerRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const point = localPoint(event)
    if (pointers.current.size === 0) {
      dragged.current = false
      pressStart.current = point
    }
    pointers.current.set(event.pointerId, point)
  }

  function onPointerMove(event: PointerEvent) {
    const previous = pointers.current.get(event.pointerId)
    if (!previous || !size) return
    // The release can land outside the map, on a control or another window.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      pointers.current.delete(event.pointerId)
      return
    }
    const point = localPoint(event)

    if (!dragged.current) {
      const pinching = pointers.current.size > 1
      if (!pinching && distance(point, pressStart.current) < DRAG_THRESHOLD) return
      dragged.current = true
    }
    // Capture only once dragging, so a plain click still reaches its pin.
    event.currentTarget.setPointerCapture(event.pointerId)

    const other = [...pointers.current].find(([id]) => id !== event.pointerId)?.[1]
    pointers.current.set(event.pointerId, point)

    setView((current) => {
      const v = clampView(current, size, aspect)
      if (!other) {
        const delta = { x: point.x - previous.x, y: point.y - previous.y }
        return panView(v, delta, size, aspect)
      }
      const before = distance(previous, other)
      const factor = before > 0 ? distance(point, other) / before : 1
      const middle = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 }
      const delta = { x: (point.x - previous.x) / 2, y: (point.y - previous.y) / 2 }
      return panView(zoomViewAt(v, middle, factor, size, aspect), delta, size, aspect)
    })
  }

  function onPointerEnd(event: PointerEvent) {
    pointers.current.delete(event.pointerId)
  }

  function onClickCapture(event: MouseEvent) {
    if (!dragged.current) return
    dragged.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  function onClick(event: MouseEvent) {
    if (!onMapClick || !stageRef.current) return
    if ((event.target as Element).closest('[data-pin]')) return
    const rect = stageRef.current.getBoundingClientRect()
    const fraction = boxToFraction({ x: event.clientX, y: event.clientY }, rect)
    if (isInsideImage(fraction)) onMapClick(fraction)
  }

  function zoomBy(factor: number) {
    if (!size) return
    const middle = { x: size.width / 2, y: size.height / 2 }
    setView((v) => zoomViewAt(clampView(v, size, aspect), middle, factor, size, aspect))
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!size) return
    const pan = (x: number, y: number) =>
      setView((v) => panView(clampView(v, size, aspect), { x, y }, size, aspect))
    const actions: Record<string, () => void> = {
      ArrowLeft: () => pan(KEY_PAN, 0),
      ArrowRight: () => pan(-KEY_PAN, 0),
      ArrowUp: () => pan(0, KEY_PAN),
      ArrowDown: () => pan(0, -KEY_PAN),
      '+': () => zoomBy(BUTTON_ZOOM),
      '=': () => zoomBy(BUTTON_ZOOM),
      '-': () => zoomBy(1 / BUTTON_ZOOM),
      '0': () => setView(INITIAL_VIEW),
    }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  // Before measuring, including on the server, CSS alone fits the stage.
  const stageStyle: CSSProperties = box
    ? { left: box.left, top: box.top, width: box.width, height: box.height }
    : {
        left: '50%',
        top: '50%',
        translate: '-50% -50%',
        aspectRatio: aspect,
        width: `min(100cqw, calc(100cqh * ${aspect}))`,
      }

  const control =
    'grid size-9 place-items-center text-parchment-200 hover:bg-ink-700 hover:text-parchment-50 disabled:opacity-35 disabled:hover:bg-transparent'

  return (
    <div className="absolute inset-0">
      {/* overflow-clip, not hidden: a focused pin must not scroll the container. */}
      <div
        ref={containerRef}
        role="group"
        aria-label={`${alt}. Drag to pan, scroll to zoom, or use the arrow, plus and minus keys.`}
        tabIndex={0}
        style={{ containerType: 'size' }}
        className={`relative size-full touch-none overflow-clip select-none focus-visible:outline-offset-[-3px] ${
          onMapClick ? 'cursor-crosshair' : 'cursor-grab'
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onDragStart={(event) => event.preventDefault()}
      >
        <div ref={stageRef} className="absolute" style={stageStyle}>
          {image && <img src={image} alt="" draggable={false} className="absolute inset-0 size-full max-w-none" />}
          {children}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0">
        {size && box && overlay?.({ size, project: (f) => fractionToBox(f, box) })}
      </div>

      <div className="absolute right-3 bottom-3 flex flex-col divide-y divide-ink-600 overflow-hidden rounded-lg border border-ink-600 bg-ink-900/90 shadow-lg">
        <button type="button" aria-label="Zoom in" className={control} disabled={shown.zoom >= MAX_ZOOM} onClick={() => zoomBy(BUTTON_ZOOM)}>
          <Plus size={16} />
        </button>
        <button type="button" aria-label="Zoom out" className={control} disabled={shown.zoom <= MIN_ZOOM} onClick={() => zoomBy(1 / BUTTON_ZOOM)}>
          <Minus size={16} />
        </button>
        <button type="button" aria-label="Reset view" className={control} onClick={() => setView(INITIAL_VIEW)}>
          <Scan size={16} />
        </button>
      </div>
    </div>
  )
}
