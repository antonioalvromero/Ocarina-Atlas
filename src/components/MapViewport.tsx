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
  type SetStateAction,
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
import { useI18n } from '../lib/i18n'
import { read, viewSlot, write, zoomSlot } from '../lib/storage'
import type { Fraction } from '../lib/types'

const DRAG_THRESHOLD = 4
const KEY_PAN = 80
const BUTTON_ZOOM = 1.5
/** Wheel and drag change the view on every event, so saving waits for a pause. */
const SAVE_DELAY = 200
/** Brief pause after manual drag/key-pan so auto-follow doesn't immediately fight the user. */
const DRAG_PAUSE_MS = 1500

export type MapViewportHandle = {
  centerOn: (fraction: Fraction) => void
  panToFraction: (x: number, y: number) => void
  resetView: () => void
}

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
  /** Set while a popover is open: the next click off a pin closes it and does nothing else. */
  onDismiss?: () => void
  /** Optional control(s) rendered directly above the zoom buttons (e.g. World Map button in fullscreen). */
  controlsAboveZoom?: ReactNode
  /** Applies safe-area inset offsets when the map fills the screen edge-to-edge. */
  isFullscreen?: boolean
  /** Pins, laid out in the stage: 0-100% of the image. */
  children?: ReactNode
  /** UI over the map that must not move or zoom with it. */
  overlay?: (projection: Projection) => ReactNode
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function MapViewport({
  viewId,
  image,
  alt,
  aspect,
  ref,
  onMapClick,
  onDismiss,
  controlsAboveZoom,
  isFullscreen = false,
  children,
  overlay,
}: Props) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size | null>(null)
  const [view, setView] = useState(INITIAL_VIEW)
  const [smoothPan, setSmoothPan] = useState(false)

  const sizeRef = useRef<Size | null>(null)
  sizeRef.current = size
  const aspectRef = useRef(aspect)
  aspectRef.current = aspect
  const viewIdRef = useRef(viewId)
  viewIdRef.current = viewId
  const latestViewRef = useRef(view)
  latestViewRef.current = view

  const pointers = useRef(new Map<number, Point>())
  const containerOrigin = useRef<Point | null>(null)
  const pressStart = useRef<Point>({ x: 0, y: 0 })
  const dragged = useRef(false)
  const pauseUntil = useRef(0)
  const dirtyRef = useRef(false)

  function flushView(targetViewId: string) {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    const current = latestViewRef.current
    write(viewSlot(targetViewId), current)
    write(zoomSlot, current.zoom)
  }

  function mutateView(updater: SetStateAction<typeof INITIAL_VIEW>) {
    dirtyRef.current = true
    setView(updater)
  }

  function applyResetView() {
    pauseUntil.current = 0
    setSmoothPan(false)
    dirtyRef.current = false
    latestViewRef.current = INITIAL_VIEW
    setView(INITIAL_VIEW)
    write(zoomSlot, INITIAL_VIEW.zoom)
    write(viewSlot(viewIdRef.current), INITIAL_VIEW)
  }

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
  useLayoutEffect(() => {
    pauseUntil.current = 0
    setSmoothPan(false)
    pointers.current.clear()
    dragged.current = false
    const saved = read(viewSlot(viewId))
    const loaded = { ...saved, zoom: read(zoomSlot) }
    dirtyRef.current = false
    latestViewRef.current = loaded
    setView(loaded)
    return () => {
      flushView(viewId)
    }
  }, [viewId])

  useEffect(() => {
    if (!dirtyRef.current) return
    const timer = setTimeout(() => flushView(viewId), SAVE_DELAY)
    return () => clearTimeout(timer)
  }, [viewId, view])

  const shown = size ? clampView(view, size, aspect) : view
  const box = size ? stageBox(shown, size, aspect) : null

  useImperativeHandle(
    ref,
    () => ({
      centerOn: ({ x, y }) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        pauseUntil.current = 0
        setSmoothPan(false)
        mutateView((v) => ({ ...v, cx: x, cy: y }))
      },
      panToFraction: (x, y) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        if (pointers.current.size > 0 || Date.now() < pauseUntil.current) return
        setSmoothPan(true)
        mutateView((v) => {
          const currentSize = sizeRef.current
          if (!currentSize) {
            return v.cx === x && v.cy === y ? v : { ...v, cx: x, cy: y }
          }
          const next = clampView({ ...v, cx: x, cy: y }, currentSize, aspectRef.current)
          if (Math.abs(next.cx - v.cx) < 1e-6 && Math.abs(next.cy - v.cy) < 1e-6) return v
          return next
        })
      },
      resetView: () => {
        applyResetView()
      },
    }),
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
      setSmoothPan(false)
      mutateView((v) => zoomViewAt(clampView(v, size, aspect), anchor, factor, size, aspect))
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [size, aspect])

  function refreshContainerOrigin() {
    const container = containerRef.current
    if (!container) return null
    const rect = container.getBoundingClientRect()
    const origin = { x: rect.left, y: rect.top }
    containerOrigin.current = origin
    return origin
  }

  function localPoint(event: { clientX: number; clientY: number }): Point {
    const origin = containerOrigin.current ?? refreshContainerOrigin() ?? { x: 0, y: 0 }
    return { x: event.clientX - origin.x, y: event.clientY - origin.y }
  }

  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    setSmoothPan(false)
    if (pointers.current.size === 0) {
      refreshContainerOrigin()
    }
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
      if (pointers.current.size === 0 && dragged.current) {
        pauseUntil.current = Date.now() + DRAG_PAUSE_MS
      }
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

    mutateView((current) => {
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
    if (pointers.current.size === 0) {
      containerOrigin.current = null
      if (dragged.current) {
        pauseUntil.current = Date.now() + DRAG_PAUSE_MS
      }
    }
  }

  function onClickCapture(event: MouseEvent) {
    if (dragged.current) {
      dragged.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (!onDismiss || (event.target as Element).closest('[data-pin]')) return
    event.stopPropagation()
    onDismiss()
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
    setSmoothPan(false)
    mutateView((v) => zoomViewAt(clampView(v, size, aspect), middle, factor, size, aspect))
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!size) return
    const pan = (x: number, y: number) => {
      pauseUntil.current = Date.now() + DRAG_PAUSE_MS
      setSmoothPan(false)
      mutateView((v) => panView(clampView(v, size, aspect), { x, y }, size, aspect))
    }
    const actions: Record<string, () => void> = {
      ArrowLeft: () => pan(KEY_PAN, 0),
      ArrowRight: () => pan(-KEY_PAN, 0),
      ArrowUp: () => pan(0, KEY_PAN),
      ArrowDown: () => pan(0, -KEY_PAN),
      '+': () => zoomBy(BUTTON_ZOOM),
      '=': () => zoomBy(BUTTON_ZOOM),
      '-': () => zoomBy(1 / BUTTON_ZOOM),
      '0': applyResetView,
    }
    const action = actions[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  // Before measuring, including on the server, CSS alone fits the stage.
  // Use GPU-composited translate3d instead of left/top to avoid layout thrashing during pan and Camera Follow.
  const stageStyle: CSSProperties = box
    ? {
        left: 0,
        top: 0,
        width: box.width,
        height: box.height,
        transform: `translate3d(${box.left}px, ${box.top}px, 0)`,
        contain: 'layout style',
      }
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
        aria-label={t('map.dragHint', { alt })}
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
        <div
          ref={stageRef}
          className={`absolute ${smoothPan ? 'transition-transform duration-150 ease-linear will-change-transform' : ''}`}
          style={stageStyle}
        >
          {image && <img src={image} alt="" draggable={false} decoding="async" className="absolute inset-0 size-full max-w-none" />}
          {children}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0">
        {size && box && overlay?.({ size, project: (f) => fractionToBox(f, box) })}
      </div>

      <div
        className="absolute right-3 bottom-3 flex flex-col items-end gap-2"
        style={
          isFullscreen
            ? {
                right: 'calc(0.75rem + env(safe-area-inset-right, 0px))',
                bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
              }
            : undefined
        }
      >
        {controlsAboveZoom}
        <div className="flex flex-col divide-y divide-ink-600 overflow-hidden rounded-lg border border-ink-600 bg-ink-900/90 shadow-lg">
          <button type="button" aria-label={t('map.zoomIn')} className={control} disabled={shown.zoom >= MAX_ZOOM} onClick={() => zoomBy(BUTTON_ZOOM)}>
            <Plus size={16} />
          </button>
          <button type="button" aria-label={t('map.zoomOut')} className={control} disabled={shown.zoom <= MIN_ZOOM} onClick={() => zoomBy(1 / BUTTON_ZOOM)}>
            <Minus size={16} />
          </button>
          <button
            type="button"
            aria-label={t('map.resetView')}
            className={control}
            onClick={applyResetView}
          >
            <Scan size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
