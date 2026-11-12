import { Compass, Crosshair, Radio, RefreshCw, Skull, Sparkles, X } from 'lucide-react'
import { formatFloorLabel } from '../lib/data'
import type { LichiiTelemetryState } from '../lib/lichii-types'
import { isLiveMemoryState, type SkulltulaToast } from '../lib/useLichiiTracker'

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

type ConnectionView = {
  label: string
  dotClass: string
  iconClass: string
  pulse: boolean
  note: string | null
}

function getConnectionView(state: LichiiTelemetryState): ConnectionView {
  if (isLiveMemoryState(state)) {
    return {
      label: 'Lichii · Live',
      dotClass: 'bg-moss',
      iconClass: 'text-moss',
      pulse: true,
      note: null,
    }
  }
  if (state.connected) {
    return {
      label: 'Lichii · Waiting for game',
      dotClass: 'bg-ember',
      iconClass: 'text-ember',
      pulse: false,
      note:
        state.source === 'save'
          ? 'RPC connected; showing save data until in-game'
          : null,
    }
  }
  if (state.source === 'save') {
    return {
      label: 'Lichii · Save only',
      dotClass: 'bg-ember/75',
      iconClass: 'text-parchment-400',
      pulse: false,
      note: 'Offline (Lichii RPC :6545 closed)',
    }
  }
  return {
    label: 'Lichii · Disconnected',
    dotClass: 'bg-parchment-600',
    iconClass: 'text-parchment-400',
    pulse: false,
    note: null,
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
}: LichiiStatusPanelProps) {
  const isLiveMemory = isLiveMemoryState(state)
  const connection = getConnectionView(state)
  const hasLocation = Boolean(state.placeName || state.scene)

  return (
    <>
      {/* Live telemetry bar at bottom-left */}
      <section
        aria-label="Lichii emulator tracker"
        className="pointer-events-auto absolute bottom-3 left-3 z-30 flex max-w-[calc(100vw-1.5rem)] flex-col gap-2 rounded-lg border border-ink-600 bg-ink-900/95 px-3.5 py-2.5 text-xs text-parchment-200 shadow-xl backdrop-blur-sm"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {/* Connection status badge */}
          <div className="flex items-center gap-1.5 font-medium text-parchment-50">
            <span className="relative flex size-2.5">
              {connection.pulse && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-moss opacity-75" />
              )}
              <span className={`relative inline-flex size-2.5 rounded-full ${connection.dotClass}`} />
            </span>
            <Radio size={13} className={connection.iconClass} />
            <span>{connection.label}</span>
          </div>

          {/* Current zone + floor + age */}
          {hasLocation && (
            <div className="flex items-center gap-1.5 border-l border-ink-600 pl-3 text-parchment-50">
              <Compass size={13} className="text-parchment-400" />
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
              <Skull size={13} className="text-[#e6b450]" />
              <span>{state.skulltulaCount}/100</span>
            </div>
          )}
        </div>

        {(connection.note || error) && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-parchment-400">
            {connection.note && <span>{connection.note}</span>}
            {error && <span className="text-ember">Error: {error}</span>}
            {error && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex cursor-pointer items-center gap-1 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[11px] font-medium text-parchment-200 transition-colors hover:bg-ink-700 hover:text-parchment-50"
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
              className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
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
            className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
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
            className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
              autoMarkSkulltulas
                ? 'border-[#e6b450]/70 bg-[#e6b450]/20 text-parchment-50'
                : 'border-ink-600 bg-ink-800 text-parchment-400 hover:text-parchment-50'
            }`}
          >
            <Skull size={11} className={autoMarkSkulltulas ? 'text-[#e6b450]' : ''} />
            Auto-Skulltula: {autoMarkSkulltulas ? 'On' : 'Off'}
          </button>

          {state.position && (
            <span className="ml-auto hidden font-mono text-[10px] text-parchment-400 tabular-nums sm:inline">
              ({state.position.x.toFixed(1)}, {state.position.y.toFixed(1)}, {state.position.z.toFixed(1)})
            </span>
          )}
        </div>
      </section>

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
