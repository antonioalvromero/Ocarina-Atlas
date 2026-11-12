import { Compass, Crosshair, Radio, RefreshCw, Skull, Sparkles, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { formatFloorLabel } from '../lib/data'
import type { LichiiTelemetryState } from '../lib/lichii-types'
import { isLiveMemoryState, type SkulltulaToast } from '../lib/useLichiiTracker'

const HOVER_CLOSE_DELAY_MS = 180
const TOUCH_HOVER_GUARD_MS = 500
const POINTER_FOCUS_GUARD_MS = 500

export type LichiiStatusPanelProps = {
  state: LichiiTelemetryState
  followPlayer: boolean
  onToggleFollow: () => void
  autoMarkSkulltulas: boolean
  onToggleAutoMark: () => void
  toasts: SkulltulaToast[]
  onDismissToast: (id: string) => void
  onJumpToPlayer?: () => void
  onSelectItem?: (itemId: string) => void
  error?: string | null
  onRetry?: () => void
}

export type ConnectionTone = 'live' | 'waiting' | 'save' | 'error' | 'disconnected'

export type ConnectionView = {
  tone: ConnectionTone
  label: string
  dotClass: string
  iconClass: string
  ringClass: string
  pulse: boolean
  note: string | null
}

function getBaseConnectionMeta(state: LichiiTelemetryState): Pick<ConnectionView, 'label' | 'note'> {
  if (isLiveMemoryState(state)) {
    return {
      label: 'Lichii · Live',
      note: null,
    }
  }
  if (state.connected) {
    return {
      label: 'Lichii · Waiting for game',
      note: state.source === 'save' ? 'RPC connected; showing save data until in-game' : null,
    }
  }
  if (state.source === 'save') {
    return {
      label: 'Lichii · Save only',
      note: 'Offline (Lichii RPC :6545 closed)',
    }
  }
  return {
    label: 'Lichii · Disconnected',
    note: null,
  }
}

export function getConnectionView(state: LichiiTelemetryState, error?: string | null): ConnectionView {
  const base = getBaseConnectionMeta(state)

  if (error) {
    return {
      tone: 'error',
      label: base.label,
      dotClass: 'bg-ember',
      iconClass: 'text-ember',
      ringClass: 'border-ember/80 shadow-[0_6px_20px_rgba(217,115,74,0.24)]',
      pulse: false,
      note: base.note,
    }
  }

  if (isLiveMemoryState(state)) {
    return {
      tone: 'live',
      label: base.label,
      dotClass: 'bg-moss',
      iconClass: 'text-moss',
      ringClass: 'border-moss/80 shadow-[0_6px_20px_rgba(134,182,126,0.25)]',
      pulse: true,
      note: base.note,
    }
  }

  if (state.connected) {
    return {
      tone: 'waiting',
      label: base.label,
      dotClass: 'bg-[#e6b450]',
      iconClass: 'text-[#e6b450]',
      ringClass: 'border-[#e6b450]/75 shadow-[0_6px_18px_rgba(230,180,80,0.18)]',
      pulse: false,
      note: base.note,
    }
  }

  if (state.source === 'save') {
    return {
      tone: 'save',
      label: base.label,
      dotClass: 'bg-[#e6b450]/85',
      iconClass: 'text-[#e6b450]',
      ringClass: 'border-[#e6b450]/65 shadow-[0_6px_18px_rgba(230,180,80,0.14)]',
      pulse: false,
      note: base.note,
    }
  }

  return {
    tone: 'disconnected',
    label: base.label,
    dotClass: 'bg-parchment-600',
    iconClass: 'text-parchment-400',
    ringClass: 'border-ink-600 shadow-xl hover:border-parchment-600',
    pulse: false,
    note: base.note,
  }
}

export type PanelInteractionState = {
  isHovered: boolean
  isFocused: boolean
  isPinned: boolean
}

export type PanelAction =
  | { type: 'hoverEnter' }
  | { type: 'hoverLeaveTimeout' }
  | { type: 'focusIn' }
  | { type: 'focusOut' }
  | { type: 'orbActivate'; mode: 'touch' | 'keyboard' | 'mouse' }
  | { type: 'collapse' }

export const INITIAL_PANEL_INTERACTION: PanelInteractionState = {
  isHovered: false,
  isFocused: false,
  isPinned: false,
}

export function isPanelOpen(state: PanelInteractionState): boolean {
  return state.isPinned || state.isHovered || state.isFocused
}

export function reducePanelInteraction(
  state: PanelInteractionState,
  action: PanelAction,
): PanelInteractionState {
  switch (action.type) {
    case 'hoverEnter':
      return state.isHovered ? state : { ...state, isHovered: true }
    case 'hoverLeaveTimeout':
      return state.isHovered ? { ...state, isHovered: false } : state
    case 'focusIn':
      return state.isFocused ? state : { ...state, isFocused: true }
    case 'focusOut':
      return state.isFocused ? { ...state, isFocused: false } : state
    case 'orbActivate': {
      const open = isPanelOpen(state)
      if (action.mode === 'touch' || action.mode === 'keyboard') {
        return open ? INITIAL_PANEL_INTERACTION : { ...state, isPinned: true }
      }
      // Desktop mouse click pins the card open on first click and collapses it on the second.
      return state.isPinned ? INITIAL_PANEL_INTERACTION : { ...state, isPinned: true }
    }
    case 'collapse':
      return INITIAL_PANEL_INTERACTION
  }
}

export function formatOrbSkulltulaCount(count: number | null): string {
  return count !== null && Number.isFinite(count) ? String(count) : '—'
}

export function buildOrbAriaLabel(
  state: LichiiTelemetryState,
  connection: ConnectionView,
  error?: string | null,
): string {
  const parts = [`Lichii emulator tracker: ${connection.label}`]
  if (error) {
    parts.push(`Error: ${error}`)
  }
  if (state.skulltulaCount !== null) {
    parts.push(`${state.skulltulaCount} of 100 Gold Skulltulas`)
  } else {
    parts.push('Gold Skulltula count unavailable')
  }
  const location = state.placeName ?? state.scene
  if (location) {
    const floor = state.mapId && state.mapId !== 'principal' ? ` (${formatFloorLabel(state.mapId)})` : ''
    parts.push(`Location: ${location}${floor}`)
  }
  return parts.join('. ')
}

export function shouldIgnoreHoverPointer(
  pointerType: string,
  lastTouchAt: number,
  now = Date.now(),
): boolean {
  if (pointerType === 'touch') return true
  return now - lastTouchAt < TOUCH_HOVER_GUARD_MS
}

export function shouldIgnorePointerFocus(params: {
  pointerActive: boolean
  lastPointerAt: number
  lastTouchAt: number
  now?: number
}): boolean {
  if (params.pointerActive) return true
  const now = params.now ?? Date.now()
  return (
    now - params.lastTouchAt < TOUCH_HOVER_GUARD_MS ||
    now - params.lastPointerAt < POINTER_FOCUS_GUARD_MS
  )
}

export function LichiiStatusPanel({
  state,
  followPlayer,
  onToggleFollow,
  autoMarkSkulltulas,
  onToggleAutoMark,
  toasts,
  onDismissToast,
  onJumpToPlayer,
  onSelectItem,
  error,
  onRetry,
}: LichiiStatusPanelProps) {
  const panelId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const orbRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTouchAtRef = useRef(0)
  const lastPointerAtRef = useRef(0)
  const pointerActiveRef = useRef(false)
  const orbPointerTypeRef = useRef<string | null>(null)
  const suppressFocusReopenRef = useRef(false)

  const [panelState, dispatch] = useReducer(reducePanelInteraction, INITIAL_PANEL_INTERACTION)

  const isOpen = isPanelOpen(panelState)
  const isLiveMemory = isLiveMemoryState(state)
  const connection = getConnectionView(state, error)
  const hasLocation = Boolean(state.placeName || state.scene)
  const countDisplay = formatOrbSkulltulaCount(state.skulltulaCount)
  const orbAriaLabel = buildOrbAriaLabel(state, connection, error)

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const collapsePanel = useCallback(
    (restoreOrbFocus = false) => {
      clearCloseTimer()
      dispatch({ type: 'collapse' })
      if (restoreOrbFocus && panelRef.current?.contains(document.activeElement)) {
        suppressFocusReopenRef.current = true
        orbRef.current?.focus()
        suppressFocusReopenRef.current = false
      }
    },
    [clearCloseTimer],
  )

  useEffect(() => {
    return () => {
      clearCloseTimer()
    }
  }, [clearCloseTimer])

  useEffect(() => {
    if (!isOpen) return

    const onDocumentPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return
      }
      collapsePanel(false)
    }

    const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        collapsePanel(true)
      }
    }

    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    document.addEventListener('keydown', onDocumentKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      document.removeEventListener('keydown', onDocumentKeyDown)
    }
  }, [isOpen, collapsePanel])

  function handleWrapperPointerEnter(event: ReactPointerEvent<HTMLDivElement>) {
    if (shouldIgnoreHoverPointer(event.pointerType, lastTouchAtRef.current)) return
    clearCloseTimer()
    dispatch({ type: 'hoverEnter' })
  }

  function handleWrapperPointerLeave(event: ReactPointerEvent<HTMLDivElement>) {
    if (shouldIgnoreHoverPointer(event.pointerType, lastTouchAtRef.current)) return
    clearCloseTimer()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      dispatch({ type: 'hoverLeaveTimeout' })
    }, HOVER_CLOSE_DELAY_MS)
  }

  function recordPointerActivity(pointerType: string, active: boolean) {
    const now = Date.now()
    pointerActiveRef.current = active
    lastPointerAtRef.current = now
    if (pointerType === 'touch' || pointerType === 'pen') {
      lastTouchAtRef.current = now
    }
  }

  function handleWrapperPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    recordPointerActivity(event.pointerType, true)
  }

  function handleWrapperPointerEndCapture(event: ReactPointerEvent<HTMLDivElement>) {
    recordPointerActivity(event.pointerType, false)
  }

  function handleWrapperKeyDownCapture() {
    pointerActiveRef.current = false
    lastPointerAtRef.current = 0
    lastTouchAtRef.current = 0
  }

  function handleWrapperFocus() {
    if (suppressFocusReopenRef.current) {
      suppressFocusReopenRef.current = false
      return
    }
    // Ignore pointer/touch-initiated button focus so touch taps don't double-toggle and clicks don't pin focus.
    if (
      shouldIgnorePointerFocus({
        pointerActive: pointerActiveRef.current,
        lastPointerAt: lastPointerAtRef.current,
        lastTouchAt: lastTouchAtRef.current,
      })
    ) {
      return
    }
    clearCloseTimer()
    dispatch({ type: 'focusIn' })
  }

  function handleWrapperBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }
    dispatch({ type: 'focusOut' })
  }

  function handleOrbPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    orbPointerTypeRef.current = event.pointerType
    recordPointerActivity(event.pointerType, true)
  }

  function handleOrbClick(event: React.MouseEvent<HTMLButtonElement>) {
    const pointerType = orbPointerTypeRef.current
    orbPointerTypeRef.current = null
    clearCloseTimer()

    if (event.detail === 0) {
      dispatch({ type: 'orbActivate', mode: 'keyboard' })
      return
    }
    if (pointerType === 'touch' || pointerType === 'pen') {
      dispatch({ type: 'orbActivate', mode: 'touch' })
      return
    }
    dispatch({ type: 'orbActivate', mode: 'mouse' })
  }

  return (
    <>
      {/* Bottom-left Gold Skulltula medallion trigger + docked telemetry card (flex-col-reverse keeps orb first in Tab order) */}
      <div
        ref={containerRef}
        onPointerEnter={handleWrapperPointerEnter}
        onPointerLeave={handleWrapperPointerLeave}
        onPointerDownCapture={handleWrapperPointerDownCapture}
        onPointerUpCapture={handleWrapperPointerEndCapture}
        onPointerCancelCapture={handleWrapperPointerEndCapture}
        onKeyDownCapture={handleWrapperKeyDownCapture}
        onFocus={handleWrapperFocus}
        onBlur={handleWrapperBlur}
        className="pointer-events-none absolute bottom-3 left-3 z-30 flex max-w-[calc(100%-1.5rem)] flex-col-reverse items-start"
      >
        {/* Compact circular Gold Skulltula medallion trigger */}
        <button
          ref={orbRef}
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          aria-label={orbAriaLabel}
          onPointerDown={handleOrbPointerDown}
          onClick={handleOrbClick}
          className={`group pointer-events-auto relative flex size-14 shrink-0 cursor-pointer flex-col items-center justify-center rounded-full border bg-ink-900/95 backdrop-blur-sm transition-[transform,border-color,box-shadow,background-color] duration-200 ease-out hover:scale-105 hover:bg-ink-800/95 active:scale-95 motion-reduce:transition-none ${connection.ringClass} ${
            isOpen ? 'ring-2 ring-[#e6b450]/35' : ''
          }`}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-1 rounded-full border border-[#e6b450]/20 transition-colors group-hover:border-[#e6b450]/40 motion-reduce:transition-none"
          />

          <Skull
            size={17}
            strokeWidth={2.1}
            aria-hidden
            className={`drop-shadow-[0_1px_2px_rgb(0_0_0/0.85)] transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none ${
              connection.tone === 'disconnected' && state.skulltulaCount === null
                ? 'text-[#e6b450]/75'
                : 'text-[#e6b450]'
            }`}
          />
          <span
            aria-hidden
            className={`mt-0.5 text-[11px] leading-none font-bold tracking-tight tabular-nums ${
              state.skulltulaCount !== null ? 'text-parchment-50' : 'text-parchment-400'
            }`}
          >
            {countDisplay}
          </span>

          <span
            aria-hidden
            className="pointer-events-none absolute top-0.5 right-0.5 flex size-3.5 items-center justify-center"
          >
            {connection.pulse && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-moss opacity-75 motion-reduce:animate-none" />
            )}
            <span
              className={`relative inline-flex size-2.5 rounded-full ring-2 ring-ink-950 ${connection.dotClass}`}
            />
          </span>
        </button>

        {/* Continuous pb-2 bridge eliminates any dead hover gap between card and orb */}
        <div
          ref={panelRef}
          id={panelId}
          role="region"
          aria-label="Lichii emulator tracker"
          aria-hidden={!isOpen}
          inert={!isOpen}
          className={`max-w-full origin-bottom-left pb-2 transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
            isOpen
              ? 'pointer-events-auto visible translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none invisible translate-y-2 scale-95 opacity-0'
          }`}
        >
          <section className="flex max-w-full flex-col gap-2 rounded-xl border border-ink-600 bg-ink-900/95 px-3.5 py-2.5 text-xs text-parchment-200 shadow-2xl backdrop-blur-sm">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
                {/* Connection status badge */}
                <div className="flex items-center gap-1.5 font-medium text-parchment-50">
                  <span className="relative flex size-2.5 shrink-0">
                    {connection.pulse && (
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-moss opacity-75 motion-reduce:animate-none" />
                    )}
                    <span className={`relative inline-flex size-2.5 rounded-full ${connection.dotClass}`} />
                  </span>
                  <Radio size={13} className={`shrink-0 ${connection.iconClass}`} />
                  <span>{connection.label}</span>
                </div>

                {/* Current zone + floor + age */}
                {hasLocation && (
                  <div className="flex items-center gap-1.5 border-l border-ink-600 pl-3 text-parchment-50">
                    <Compass size={13} className="shrink-0 text-parchment-400" />
                    <span className="font-medium">{state.placeName ?? state.scene}</span>
                    {state.mapId && state.mapId !== 'principal' && (
                      <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] font-semibold text-parchment-200">
                        {formatFloorLabel(state.mapId)}
                      </span>
                    )}
                    {state.age && (
                      <span className="text-[11px] text-parchment-400 capitalize">
                        ({state.age})
                      </span>
                    )}
                  </div>
                )}

                {/* In-game Gold Skulltula counter */}
                {state.skulltulaCount !== null && (
                  <div
                    title="Gold Skulltulas collected in this save"
                    className="flex items-center gap-1 border-l border-ink-600 pl-3 font-medium text-parchment-50 tabular-nums"
                  >
                    <Skull size={13} className="shrink-0 text-[#e6b450]" />
                    <span>{state.skulltulaCount}/100</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                aria-label="Collapse tracker panel"
                onClick={(event) => collapsePanel(event.detail === 0)}
                className="-mt-1 -mr-1.5 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-parchment-400 transition-colors hover:bg-ink-700 hover:text-parchment-50 motion-reduce:transition-none"
              >
                <X size={14} />
              </button>
            </div>

            {(connection.note || error) && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-parchment-400">
                {connection.note && <span>{connection.note}</span>}
                {error && <span className="text-ember">Error: {error}</span>}
                {error && onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[11px] font-medium text-parchment-200 transition-colors hover:bg-ink-700 hover:text-parchment-50 motion-reduce:transition-none"
                  >
                    <RefreshCw size={11} />
                    Retry
                  </button>
                )}
              </div>
            )}

            {/* Controls row */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {onJumpToPlayer && hasLocation && (
                <button
                  type="button"
                  onClick={onJumpToPlayer}
                  className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none ${
                    isLiveMemory
                      ? 'border-moss/60 bg-moss/15 text-parchment-50 hover:bg-moss hover:text-ink-950'
                      : 'border-ink-600 bg-ink-800 text-parchment-200 hover:bg-ink-700 hover:text-parchment-50'
                  }`}
                >
                  <Crosshair size={12} />
                  Go to Link
                </button>
              )}

              <button
                type="button"
                aria-pressed={followPlayer}
                onClick={onToggleFollow}
                className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none ${
                  followPlayer
                    ? 'border-parchment-400 bg-parchment-200 text-ink-950'
                    : 'border-ink-600 bg-ink-800 text-parchment-400 hover:text-parchment-50'
                }`}
              >
                Follow Link: {followPlayer ? 'On' : 'Off'}
              </button>

              <button
                type="button"
                aria-pressed={autoMarkSkulltulas}
                onClick={onToggleAutoMark}
                className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none ${
                  autoMarkSkulltulas
                    ? 'border-[#e6b450]/70 bg-[#e6b450]/20 text-parchment-50'
                    : 'border-ink-600 bg-ink-800 text-parchment-400 hover:text-parchment-50'
                }`}
              >
                <Skull size={11} className={autoMarkSkulltulas ? 'text-[#e6b450]' : ''} />
                Auto-Skulltula: {autoMarkSkulltulas ? 'On' : 'Off'}
              </button>

              {state.position && (
                <span className="font-mono text-[10px] text-parchment-400 tabular-nums sm:ml-auto">
                  ({state.position.x.toFixed(1)}, {state.position.y.toFixed(1)}, {state.position.z.toFixed(1)})
                </span>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Auto-marked Skulltula toast notifications at top-right */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute top-3 right-3 z-40 flex max-w-sm flex-col gap-2"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-[#e6b450]/80 bg-ink-900/95 px-3.5 py-2.5 text-parchment-50 shadow-xl backdrop-blur-sm"
            >
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[#e6b450]/20 text-[#e6b450]">
                <Sparkles size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[#e6b450]">
                  Gold Skulltula collected!
                  {toast.skulltulaCount !== null && (
                    <span className="ml-1 font-normal text-parchment-200">
                      (#{toast.skulltulaCount})
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => onSelectItem?.(toast.itemId)}
                  className="mt-0.5 block cursor-pointer truncate text-left text-xs font-medium text-parchment-50 underline-offset-2 hover:underline"
                >
                  {toast.itemName}
                </button>
                <p className="text-[11px] text-parchment-400">{toast.placeName}</p>
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => onDismissToast(toast.id)}
                className="cursor-pointer rounded p-0.5 text-parchment-400 hover:bg-ink-700 hover:text-parchment-50"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
