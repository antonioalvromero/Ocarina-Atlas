import { useEffect, useId, useState } from 'react'
import { pinPosition } from '../lib/coords'
import type { Fraction } from '../lib/types'

export type PlayerPinProps = {
  at: Fraction
  yaw?: number | null
  label?: string | null
  sublabel?: string | null
  position3d?: { x: number; y: number; z: number } | null
  live?: boolean
  onClick?: () => void
}

export function PlayerPin({
  at,
  yaw,
  label = 'Link',
  sublabel,
  position3d,
  live = true,
  onClick,
}: PlayerPinProps) {
  const coneGradId = useId()
  // Backend reports compass yaw: 0° = North (-Z, up on map), 90° = East (+X, right), 180° = South (+Z, down), 270° = West (-X, left).
  const targetRot = typeof yaw === 'number' && Number.isFinite(yaw) ? yaw : null
  const [rotationDeg, setRotationDeg] = useState<number | null>(targetRot)

  useEffect(() => {
    if (targetRot === null) {
      setRotationDeg(null)
      return
    }
    setRotationDeg((prev) => {
      if (prev === null) return targetRot
      const delta = ((((targetRot - prev) % 360) + 540) % 360) - 180
      return delta === 0 ? prev : prev + delta
    })
  }, [targetRot])

  const baseTitle = `${label}${sublabel ? ` (${sublabel})` : ''}${live ? '' : ' (Saved)'}`
  const ariaLabel = position3d
    ? `${baseTitle} at X ${position3d.x.toFixed(1)}, Y ${position3d.y.toFixed(1)}, Z ${position3d.z.toFixed(1)}`
    : baseTitle

  return (
    <div
      data-pin
      data-player-pin
      className="absolute z-40 size-0 transition-[left,top] duration-150 ease-linear will-change-[left,top]"
      style={pinPosition(at)}
    >
      <div
        onClick={(e) => {
          if (onClick) {
            e.stopPropagation()
            onClick()
          }
        }}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={(e) => {
          if (onClick && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            e.stopPropagation()
            onClick()
          }
        }}
        title={baseTitle}
        aria-label={ariaLabel}
        className={`group relative -top-5 -left-5 flex size-10 items-center justify-center ${
          onClick ? 'cursor-pointer' : 'pointer-events-auto'
        }`}
      >
        {/* Outer sonar pulse (only when streaming live RAM) */}
        {live && (
          <span
            className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-moss/50 opacity-75"
            style={{ animationDuration: '2s' }}
            aria-hidden
          />
        )}

        {/* Directional view cone & heading arrow */}
        {rotationDeg !== null && (
          <svg
            viewBox="0 0 64 64"
            className="pointer-events-none absolute -inset-3 size-16 drop-shadow-[0_2px_4px_rgb(0_0_0/0.8)] transition-transform duration-150 ease-linear"
            style={{ transform: `rotate(${rotationDeg}deg)` }}
            aria-hidden
          >
            <defs>
              <linearGradient id={coneGradId} x1="0" y1="1" x2="0" y2="0">
                <stop
                  offset="0%"
                  stopColor={live ? '#86b67e' : '#d9734a'}
                  stopOpacity={live ? '0.55' : '0.35'}
                />
                <stop offset="100%" stopColor="#f8f1e0" stopOpacity="0.0" />
              </linearGradient>
            </defs>
            {/* Vision cone pointing up (North at 0 deg) */}
            <path d="M32 32 L18 6 A24 24 0 0 1 46 6 Z" fill={`url(#${coneGradId})`} />
            {/* Crisp direction pointer tip */}
            <path
              d="M32 7 L38 19 L32 15.5 L26 19 Z"
              fill={live ? '#f8f1e0' : '#e6d8b8'}
              stroke="#13100c"
              strokeWidth="1.75"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {/* Core player emblem (Triforce / Link crest marker) */}
        <span
          className={`relative grid size-6 place-items-center rounded-full border-2 border-ink-950 text-ink-950 transition-transform group-hover:scale-120 ${
            live
              ? 'bg-moss shadow-[0_0_12px_rgba(134,182,126,0.9)]'
              : 'bg-ember/85 opacity-90 shadow-md'
          }`}
        >
          <svg viewBox="0 0 24 24" className="size-3.5 fill-ink-950" aria-hidden>
            <path d="M12 3L16.5 11H7.5L12 3ZM7.5 11L12 19H3L7.5 11ZM16.5 11L21 19H12L16.5 11Z" />
          </svg>
        </span>

        {/* Floating label & coordinates tooltip */}
        <div className="pointer-events-none absolute top-full left-1/2 mt-1 flex -translate-x-1/2 flex-col items-center">
          <span
            className={`flex items-center gap-1 rounded border bg-ink-950/90 px-1.5 py-0.5 text-[11px] leading-tight font-semibold whitespace-nowrap shadow-md ${
              live ? 'border-moss/80 text-parchment-50' : 'border-ember/60 text-parchment-200'
            }`}
          >
            <span className={`size-1.5 rounded-full ${live ? 'bg-moss' : 'bg-ember/80'}`} />
            {label}
            {sublabel && <span className="font-normal text-parchment-400">· {sublabel}</span>}
            {!live && <span className="font-normal text-ember">(Saved)</span>}
          </span>
          {position3d && (
            <span className="mt-0.5 hidden rounded border border-ink-600 bg-ink-950/95 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-parchment-200 shadow group-hover:block">
              X:{position3d.x.toFixed(1)} Y:{position3d.y.toFixed(1)} Z:{position3d.z.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
