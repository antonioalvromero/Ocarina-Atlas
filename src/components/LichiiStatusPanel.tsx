import { CheckCircle2, Compass, Crosshair, Eye, EyeOff, Radio, RefreshCw, Skull, SlidersHorizontal, Sparkles, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { dataset, formatFloorLabel } from '../lib/data'
import { DEFAULT_LOCALE, translate, translatePlace, useI18n, type Locale } from '../lib/i18n'
import { hideDoneSlot, officialVisibleSlot, prereqFilterEnabledSlot, useStored, write } from '../lib/storage'

const itemsById = new Map(dataset.items.map((item) => [item.id, item]))
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
  isFullscreen?: boolean
  /** CSS length (e.g. '5.75rem') overriding the default fullscreen top-right toast offset when extra controls stack under Exit fullscreen. */
  fullscreenToastTop?: string
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

function getEmulatorDisplayName(emulator?: LichiiTelemetryState['emulator']): string {
  if (emulator === 'fritchii') return 'Fritchii'
  if (emulator === 'eden') return 'Eden'
  if (emulator === 'cheezyemu') return 'CheezyEmu'
  if (emulator === 'longshot') return 'Longshot'
  if (emulator === 'relink') return 'Project ReLink'
  if (emulator === 'triforce') return 'Triforce'
  if (emulator === 'nx2saria') return 'NX2Saria'
  if (emulator === 'ootpc') return 'OOT-PC'
  return 'Lichii'
}

function formatLocalizedFloorLabel(mapId: string, locale: Locale): string {
  if (mapId === 'nino') return translate(locale, 'floor.child')
  if (mapId === 'adulto') return translate(locale, 'floor.adult')
  if (mapId === 'principal') return translate(locale, 'floor.main')
  return formatFloorLabel(mapId)
}

function getBaseConnectionMeta(
  state: LichiiTelemetryState,
  locale: Locale = DEFAULT_LOCALE,
): Pick<ConnectionView, 'label' | 'note'> {
  const emulatorName = getEmulatorDisplayName(state.emulator)
  if (isLiveMemoryState(state)) {
    return {
      label: `${emulatorName} · ${translate(locale, 'tracker.live')}`,
      note: null,
    }
  }
  if (state.connected) {
    return {
      label: `${emulatorName} · ${translate(locale, 'tracker.waitingForGame')}`,
      note: state.source === 'save' ? translate(locale, 'tracker.waitingNote') : null,
    }
  }
  if (state.source === 'save') {
    return {
      label: `${emulatorName} · ${translate(locale, 'tracker.saveOnly')}`,
      note: translate(locale, 'tracker.offlineNote', { emulator: emulatorName }),
    }
  }
  return {
    label: `${emulatorName} · ${translate(locale, 'tracker.disconnected')}`,
    note: null,
  }
}

export function getConnectionView(
  state: LichiiTelemetryState,
  error?: string | null,
  locale: Locale = DEFAULT_LOCALE,
): ConnectionView {
  const base = getBaseConnectionMeta(state, locale)

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
  locale: Locale = DEFAULT_LOCALE,
): string {
  const parts = [
    `${translate(locale, 'tracker.emulatorTracker', { emulator: getEmulatorDisplayName(state.emulator) })}: ${connection.label}`,
  ]
  if (error) {
    parts.push(translate(locale, 'tracker.errorPrefix', { error }))
  }
  if (state.skulltulaCount !== null) {
    parts.push(translate(locale, 'tracker.ariaSkulltulas', { count: state.skulltulaCount }))
  } else {
    parts.push(translate(locale, 'tracker.ariaSkulltulasUnavailable'))
  }
  const location = state.placeId
    ? translatePlace(locale, state.placeId, state.placeName ?? state.scene ?? undefined)
    : (state.placeName ?? state.scene)
  if (location) {
    const floor =
      state.mapId && state.mapId !== 'principal'
        ? ` (${formatLocalizedFloorLabel(state.mapId, locale)})`
        : ''
    parts.push(translate(locale, 'tracker.ariaLocation', { location: `${location}${floor}` }))
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

export async function switchSaveSlot(slot: string | null): Promise<boolean> {
  try {
    const trimmed = typeof slot === 'string' ? slot.trim() : ''
    const res = await fetch('/api/saves/slot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot: trimmed || null }),
    })
    return res.ok
  } catch {
    return false
  }
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
  isFullscreen = false,
  fullscreenToastTop = '3.25rem',
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

  const { locale, t, tPlace, tItemName } = useI18n()
  const showOfficialPins = useStored(officialVisibleSlot)
  const prereqFilterEnabled = useStored(prereqFilterEnabledSlot)
  const hideDone = useStored(hideDoneSlot)
  const [panelState, dispatch] = useReducer(reducePanelInteraction, INITIAL_PANEL_INTERACTION)
  const [selectedSlot, setSelectedSlot] = useState<string | undefined>(undefined)
  const [isSwitchingSlot, setIsSwitchingSlot] = useState(false)

  const saveTelemetry = state as LichiiTelemetryState & {
    availableSaveSlots?: string[]
    activeSaveSlot?: string | null
    activeSaveDir?: string | null
  }
  const availableSaveSlots = Array.isArray(saveTelemetry.availableSaveSlots)
    ? saveTelemetry.availableSaveSlots.filter(
        (slot): slot is string => typeof slot === 'string' && slot.trim().length > 0,
      )
    : []
  const activeSaveSlot =
    typeof saveTelemetry.activeSaveSlot === 'string' && saveTelemetry.activeSaveSlot.trim().length > 0
      ? saveTelemetry.activeSaveSlot.trim()
      : null
  const activeSaveDir =
    typeof saveTelemetry.activeSaveDir === 'string' && saveTelemetry.activeSaveDir.trim().length > 0
      ? saveTelemetry.activeSaveDir.trim()
      : null
  const showSaveSlotPicker =
    availableSaveSlots.length > 1 || (Boolean(activeSaveSlot) && state.source !== 'none')
  const slotOptions = Array.from(
    new Set([...availableSaveSlots, ...(activeSaveSlot ? [activeSaveSlot] : [])]),
  )

  const isOpen = isPanelOpen(panelState)
  const isLiveMemory = isLiveMemoryState(state)
  const connection = getConnectionView(state, error, locale)
  const hasLocation = Boolean(state.placeName || state.scene)
  const countDisplay = formatOrbSkulltulaCount(state.skulltulaCount)
  const orbAriaLabel = buildOrbAriaLabel(state, connection, error, locale)

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
        style={
          isFullscreen
            ? {
                bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
                left: 'calc(0.75rem + env(safe-area-inset-left, 0px))',
              }
            : undefined
        }
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
          aria-label={t('tracker.emulatorTracker', { emulator: getEmulatorDisplayName(state.emulator) })}
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
                    <span className="font-medium">
                      {state.placeId
                        ? tPlace(state.placeId, state.placeName ?? state.scene ?? undefined)
                        : (state.placeName ?? state.scene)}
                    </span>
                    {state.mapId && state.mapId !== 'principal' && (
                      <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] font-semibold text-parchment-200">
                        {formatLocalizedFloorLabel(state.mapId, locale)}
                      </span>
                    )}
                    {state.age && (
                      <span className="text-[11px] text-parchment-400 capitalize">
                        (
                        {state.age === 'child'
                          ? t('panel.ageChild').toLowerCase()
                          : state.age === 'adult'
                            ? t('panel.ageAdult').toLowerCase()
                            : state.age}
                        )
                      </span>
                    )}
                  </div>
                )}

                {/* In-game Gold Skulltula counter */}
                {state.skulltulaCount !== null && (
                  <div
                    title={t('tracker.skulltulasTitle')}
                    className="flex items-center gap-1 border-l border-ink-600 pl-3 font-medium text-parchment-50 tabular-nums"
                  >
                    <Skull size={13} className="shrink-0 text-[#e6b450]" />
                    <span>{state.skulltulaCount}/100</span>
                  </div>
                )}
              </div>

              <button
                type="button"
                aria-label={t('tracker.collapsePanel')}
                onClick={(event) => collapsePanel(event.detail === 0)}
                className="-mt-1 -mr-1.5 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-parchment-400 transition-colors hover:bg-ink-700 hover:text-parchment-50 motion-reduce:transition-none"
              >
                <X size={14} />
              </button>
            </div>

            {(connection.note || error) && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-parchment-400">
                {connection.note && <span>{connection.note}</span>}
                {error && <span className="text-ember">{t('tracker.errorPrefix', { error })}</span>}
                {error && onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex cursor-pointer items-center gap-1 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[11px] font-medium text-parchment-200 transition-colors hover:bg-ink-700 hover:text-parchment-50 motion-reduce:transition-none"
                  >
                    <RefreshCw size={11} />
                    {t('common.retry')}
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
                  {t('tracker.goToLink')}
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
                {t('tracker.followLink', { state: followPlayer ? t('common.on') : t('common.off') })}
              </button>

              <button
                type="button"
                aria-pressed={autoMarkSkulltulas}
                onClick={onToggleAutoMark}
                title={t('tracker.autoTrackingTitle')}
                className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none ${
                  autoMarkSkulltulas
                    ? 'border-[#e6b450]/70 bg-[#e6b450]/20 text-parchment-50'
                    : 'border-ink-600 bg-ink-800 text-parchment-400 hover:text-parchment-50'
                }`}
              >
                <Sparkles size={11} className={autoMarkSkulltulas ? 'text-[#e6b450]' : ''} />
                {t('tracker.autoTracking', {
                  state: autoMarkSkulltulas ? t('common.on') : t('common.off'),
                })}
              </button>

              {showSaveSlotPicker && (
                <div
                  className="inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-2 py-0.5 text-[11px] text-parchment-200"
                  title={activeSaveDir ?? undefined}
                >
                  <label htmlFor={`${panelId}-save-slot`} className="font-medium text-parchment-400">
                    Save Slot
                  </label>
                  <select
                    id={`${panelId}-save-slot`}
                    aria-label="Save Slot"
                    disabled={isSwitchingSlot}
                    value={selectedSlot ?? activeSaveSlot ?? ''}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      setSelectedSlot(nextValue)
                      setIsSwitchingSlot(true)
                      void switchSaveSlot(nextValue || null).finally(() => {
                        setIsSwitchingSlot(false)
                      })
                    }}
                    className="cursor-pointer rounded border border-ink-600 bg-ink-900 px-1.5 py-0.5 text-[11px] font-semibold text-parchment-50 focus:border-[#e6b450] focus:outline-none disabled:opacity-60"
                  >
                    <option value="">Auto</option>
                    {slotOptions.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                  {activeSaveSlot && (
                    <span className="font-mono text-[10px] text-[#e6b450]">{activeSaveSlot}</span>
                  )}
                </div>
              )}
            </div>

            {/* Quick map filter toggles */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-ink-700/70 pt-1.5">
              <button
                type="button"
                aria-pressed={showOfficialPins}
                onClick={() => write(officialVisibleSlot, !showOfficialPins)}
                title={t('panel.showOfficialPins')}
                className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none ${
                  showOfficialPins
                    ? 'border-moss/60 bg-moss/15 text-parchment-50'
                    : 'border-ink-600 bg-ink-800 text-parchment-400 hover:text-parchment-50'
                }`}
              >
                {showOfficialPins ? (
                  <Eye size={11} className="shrink-0 text-moss" aria-hidden />
                ) : (
                  <EyeOff size={11} className="shrink-0" aria-hidden />
                )}
                <span>{t('place.officialPins')}</span>
              </button>

              <button
                type="button"
                aria-pressed={prereqFilterEnabled}
                onClick={() => write(prereqFilterEnabledSlot, !prereqFilterEnabled)}
                title={t('filter.prereqNotice')}
                className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none ${
                  prereqFilterEnabled
                    ? 'border-[#e6b450]/70 bg-[#e6b450]/20 text-parchment-50'
                    : 'border-ink-600 bg-ink-800 text-parchment-400 hover:text-parchment-50'
                }`}
              >
                <SlidersHorizontal
                  size={11}
                  className={`shrink-0 ${prereqFilterEnabled ? 'text-[#e6b450]' : ''}`}
                  aria-hidden
                />
                <span>{t('filter.prereqOnly')}</span>
              </button>

              <button
                type="button"
                aria-pressed={hideDone}
                onClick={() => write(hideDoneSlot, !hideDone)}
                title={t('filter.hideCompleted')}
                className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none ${
                  hideDone
                    ? 'border-moss/60 bg-moss/15 text-parchment-50'
                    : 'border-ink-600 bg-ink-800 text-parchment-400 hover:text-parchment-50'
                }`}
              >
                <CheckCircle2
                  size={11}
                  className={`shrink-0 ${hideDone ? 'text-moss' : ''}`}
                  aria-hidden
                />
                <span>{t('filter.hideCompleted')}</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Auto-marked Skulltula toast notifications at top-right */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          style={
            isFullscreen
              ? {
                  top: `calc(${fullscreenToastTop} + env(safe-area-inset-top, 0px))`,
                  right: 'calc(0.75rem + env(safe-area-inset-right, 0px))',
                }
              : undefined
          }
          className={`pointer-events-none absolute right-3 z-40 flex max-w-sm flex-col gap-2 ${
            isFullscreen ? 'top-13' : 'top-3'
          }`}
        >
          {toasts.map((toast) => {
            const item = itemsById.get(toast.itemId)
            const displayItemName = tItemName(toast.itemId, toast.itemName)
            const displayPlaceName = item ? tPlace(item.place, toast.placeName) : toast.placeName
            return (
              <div
                key={toast.id}
                className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-[#e6b450]/80 bg-ink-900/95 px-3.5 py-2.5 text-parchment-50 shadow-xl backdrop-blur-sm"
              >
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[#e6b450]/20 text-[#e6b450]">
                  <Sparkles size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#e6b450]">
                    {t('tracker.skulltulaCollected')}
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
                    {displayItemName}
                  </button>
                  <p className="text-[11px] text-parchment-400">{displayPlaceName}</p>
                </div>
                <button
                  type="button"
                  aria-label={t('tracker.dismissNotification')}
                  onClick={() => onDismissToast(toast.id)}
                  className="cursor-pointer rounded p-0.5 text-parchment-400 hover:bg-ink-700 hover:text-parchment-50"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
