import { useState, type FormEvent } from 'react'
import type { Projection } from './MapViewport'
import { OTHER_PIN, PIN_TYPES } from '../lib/pinTypes'
import type { Fraction } from '../lib/types'
import { categoryStyle } from './categories'

const WIDTH = 288
const HEIGHT = 244
const GAP = 12

function TypeTile({ type, label, autoFocus, onPick }: { type: string; label: string; autoFocus: boolean; onPick: () => void }) {
  const { icon: Icon, color } = categoryStyle(type)
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onPick}
      className="flex h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded border border-ink-600 bg-ink-950 px-1 text-center text-[11px] leading-tight text-parchment-200 hover:border-parchment-400 hover:text-parchment-50"
    >
      <Icon size={15} style={{ color }} aria-hidden />
      {label}
    </button>
  )
}

export function NewPinPopover({
  at,
  projection,
  onCreate,
  onCancel,
}: {
  at: Fraction
  projection: Projection
  onCreate: (type: string, name?: string) => void
  onCancel: () => void
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const { size, project } = projection
  const anchor = project(at)
  const left = Math.max(8, Math.min(anchor.x - WIDTH / 2, size.width - WIDTH - 8))
  const below = anchor.y + GAP + HEIGHT <= size.height
  const top = Math.max(8, below ? anchor.y + GAP : anchor.y - 36 - HEIGHT)

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed) onCreate(OTHER_PIN, trimmed)
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      style={{ left, top, width: WIDTH }}
      className="pointer-events-auto absolute z-40 rounded-lg border border-parchment-600 bg-ink-900 p-3 shadow-xl shadow-black/50"
    >
      {naming ? (
        <label className="block text-xs font-medium text-parchment-400">
          Pin name
          <input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded border border-ink-600 bg-ink-950 px-2 py-1.5 text-sm text-parchment-50 outline-none focus:border-parchment-400"
          />
        </label>
      ) : (
        <>
          <p className="mb-1.5 text-xs font-medium text-parchment-400">What did you find?</p>
          <div className="grid grid-cols-3 gap-1.5">
            {PIN_TYPES.map(({ key, label }, index) => (
              <TypeTile
                key={key}
                type={key}
                label={label}
                autoFocus={index === 0}
                onPick={() => (key === OTHER_PIN ? setNaming(true) : onCreate(key))}
              />
            ))}
          </div>
        </>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded px-2.5 py-1 text-xs text-parchment-400 hover:text-parchment-50">
          Cancel
        </button>
        {naming && (
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded bg-parchment-200 px-2.5 py-1 text-xs font-medium text-ink-950 hover:bg-parchment-50 disabled:opacity-40"
          >
            Add pin
          </button>
        )}
      </div>
    </form>
  )
}
