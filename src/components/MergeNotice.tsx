import { Check, Undo2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Merge } from '../lib/merge'
import { categoryStyle } from './categories'

const LIFETIME = 8000

/** Remount with a `key` per merge, so each one gets its full time. */
export function MergeNotice({
  merge,
  done,
  onComplete,
  onUndo,
  onDismiss,
}: {
  merge: Merge
  done: boolean
  onComplete: () => void
  onUndo: () => void
  onDismiss: () => void
}) {
  const [paused, setPaused] = useState(false)
  const { icon: Icon, color } = categoryStyle(merge.item.cat)

  useEffect(() => {
    if (paused) return
    const timer = setTimeout(onDismiss, LIFETIME)
    return () => clearTimeout(timer)
  }, [paused])

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="absolute right-16 bottom-3 left-3 z-30 mx-auto max-w-sm rounded-lg border border-parchment-600 bg-ink-900 p-3 shadow-xl shadow-black/50"
    >
      <div className="flex items-start gap-2.5">
        <span style={{ borderColor: color, color }} className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border-2 bg-ink-950">
          <Icon size={15} strokeWidth={2.25} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-parchment-400">
            {merge.appeared ? 'Merged with official pin' : 'This one already exists'}
          </p>
          <p className="text-sm leading-snug text-parchment-50">{merge.item.name}</p>
          <p className="mt-0.5 text-xs text-parchment-400">Your pin was close enough, so the official one replaces it.</p>
        </div>
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="cursor-pointer text-parchment-400 hover:text-parchment-50">
          <X size={15} />
        </button>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        {!done && (
          <button
            type="button"
            onClick={onComplete}
            className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs text-parchment-200 hover:text-parchment-50"
          >
            <Check size={13} /> Mark completed
          </button>
        )}
        <button
          type="button"
          onClick={onUndo}
          className="flex cursor-pointer items-center gap-1 rounded bg-parchment-200 px-2 py-1 text-xs font-medium text-ink-950 hover:bg-parchment-50"
        >
          <Undo2 size={13} /> Undo
        </button>
      </div>
    </div>
  )
}
