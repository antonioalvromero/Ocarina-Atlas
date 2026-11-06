import { Check, MapPin } from 'lucide-react'
import type { CSSProperties } from 'react'
import { pinPosition } from '../lib/coords'
import { categoryName } from '../lib/data'
import type { Merge } from '../lib/merge'
import { OTHER_PIN, pinTypeLabel } from '../lib/pinTypes'
import type { CustomPin } from '../lib/storage'
import type { Fraction, Item } from '../lib/types'
import { categoryStyle } from './categories'

/*
 * Each marker hangs from a zero-size anchor placed at its fraction of the
 * stage, so the anchor is the exact image point at every zoom and size.
 */

function PinGlyph({ type }: { type: string }) {
  if (type === OTHER_PIN) {
    return <MapPin size={28} strokeWidth={1.75} className="fill-parchment-200 text-ink-950 drop-shadow-[0_2px_2px_rgb(0_0_0/0.6)]" />
  }
  const { icon: Icon, color } = categoryStyle(type)
  return (
    <span className="relative block size-7 shrink-0 drop-shadow-[0_2px_2px_rgb(0_0_0/0.6)]">
      <svg viewBox="0 0 24 24" fill={color} stroke="var(--color-ink-950)" strokeWidth={1.75} strokeLinejoin="round" className="size-full" aria-hidden>
        <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      </svg>
      <Icon size={12} strokeWidth={2.5} className="absolute top-1.5 left-2 text-ink-950" aria-hidden />
    </span>
  )
}

/** The small tick on the corner of a completed marker, which keeps its icon. */
function DoneBadge() {
  return (
    <span className="pointer-events-none absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full border border-ink-950 bg-moss text-ink-950" aria-hidden>
      <Check size={9} strokeWidth={4} />
    </span>
  )
}

export function CustomMarker({
  pin,
  selected,
  onSelect,
}: {
  pin: CustomPin
  selected: boolean
  onSelect: () => void
}) {
  // A typed pin with its default name says the same as its icon.
  const labelled = selected || pin.type === OTHER_PIN || pin.name !== pinTypeLabel(pin.type)
  return (
    <div data-pin className={`absolute size-0 hover:z-30 ${selected ? 'z-30' : 'z-20'}`} style={pinPosition(pin)}>
      <button
        type="button"
        aria-label={`${pin.name}, your pin${pin.done ? ', completed' : ''}`}
        aria-pressed={selected}
        onClick={onSelect}
        className="group absolute bottom-0 left-0 flex w-max -translate-x-3.5 translate-y-0.5 cursor-pointer items-end gap-0.5 rounded"
      >
        <span className="relative block shrink-0">
          <PinGlyph type={pin.type} />
          {pin.done && <DoneBadge />}
        </span>
        <span
          className={`mb-1 max-w-40 truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
            selected ? 'bg-parchment-50 text-ink-950' : pin.done ? 'bg-ink-950/85 text-parchment-400' : 'bg-ink-950/85 text-parchment-50'
          } ${pin.done ? 'line-through' : ''} ${labelled ? '' : 'hidden group-hover:block group-focus-visible:block'}`}
        >
          {pin.name}
        </span>
      </button>
    </div>
  )
}

export function DraftMarker({ at }: { at: Fraction }) {
  return (
    <div className="pointer-events-none absolute z-30 size-0" style={pinPosition(at)}>
      <MapPin size={28} strokeWidth={1.75} className="absolute -bottom-0.5 -left-3.5 animate-pulse fill-ember text-ink-950" />
    </div>
  )
}

/** Your pin sliding along a dashed line to the official pin it merged into. */
export function MergeTrail({ merge }: { merge: Merge }) {
  const from = pinPosition(merge.from)
  const to = pinPosition(merge.to)
  const route = { '--from-x': from.left, '--from-y': from.top, '--to-x': to.left, '--to-y': to.top } as CSSProperties
  return (
    <>
      <svg className="merge-trail pointer-events-none absolute inset-0 z-20 size-full" aria-hidden>
        <line x1={from.left} y1={from.top} x2={to.left} y2={to.top} stroke="var(--color-parchment-50)" strokeWidth={2} strokeDasharray="5 5" />
      </svg>
      <div className="merge-ghost pointer-events-none absolute z-30 size-0" style={route} aria-hidden>
        <span className="absolute bottom-0 left-0 block -translate-x-3.5 translate-y-0.5">
          <PinGlyph type={merge.type} />
        </span>
      </div>
    </>
  )
}

export function OfficialMarker({
  item,
  at,
  done,
  selected,
  merge,
  onSelect,
}: {
  item: Item
  at: Fraction
  done: boolean
  selected: boolean
  /** The latest merge, which this marker may be the target of. */
  merge: Merge | null
  onSelect: () => void
}) {
  const { icon: Icon, color } = categoryStyle(item.cat)
  const target = merge?.item.id === item.id ? merge : null
  return (
    <div data-pin className={`absolute size-0 hover:z-30 ${selected ? 'z-30' : 'z-10'}`} style={pinPosition(at)}>
      {target && (
        <span key={target.id} style={{ color }} className="merge-ring pointer-events-none absolute -top-3.5 -left-3.5 size-7 rounded-full border-2" />
      )}
      <button
        type="button"
        title={item.name}
        aria-label={`${item.name}, ${categoryName(item.cat)}${done ? ', completed' : ''}`}
        aria-pressed={selected}
        onClick={onSelect}
        style={{ borderColor: color, color }}
        className={`absolute -top-3.5 -left-3.5 grid size-7 cursor-pointer place-items-center rounded-full border-2 bg-ink-950 shadow-md shadow-black/50 transition-transform hover:scale-115 ${
          selected ? 'scale-125 ring-2 ring-parchment-50' : ''
        } ${target?.appeared ? 'merge-pop' : ''}`}
      >
        <Icon size={15} strokeWidth={2.25} />
        {done && <DoneBadge />}
      </button>
    </div>
  )
}
