import { useState, type FormEvent } from 'react'
import type { Projection } from './MapViewport'
import type { Fraction } from '../lib/types'

const WIDTH = 256
const HEIGHT = 112
const GAP = 12

export function NewPinPopover({
  at,
  projection,
  onCreate,
  onCancel,
}: {
  at: Fraction
  projection: Projection
  onCreate: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const { size, project } = projection
  const anchor = project(at)
  const left = Math.max(8, Math.min(anchor.x - WIDTH / 2, size.width - WIDTH - 8))
  const below = anchor.y + GAP + HEIGHT <= size.height
  const top = Math.max(8, below ? anchor.y + GAP : anchor.y - 36 - HEIGHT)

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed) onCreate(trimmed)
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => event.key === 'Escape' && onCancel()}
      style={{ left, top, width: WIDTH }}
      className="pointer-events-auto absolute z-40 rounded-lg border border-parchment-600 bg-ink-900 p-3 shadow-xl shadow-black/50"
    >
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
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded px-2.5 py-1 text-xs text-parchment-400 hover:text-parchment-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="rounded bg-parchment-200 px-2.5 py-1 text-xs font-medium text-ink-950 hover:bg-parchment-50 disabled:opacity-40"
        >
          Add pin
        </button>
      </div>
    </form>
  )
}
