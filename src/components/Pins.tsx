import { Check, MapPin } from 'lucide-react'
import { pinPosition } from '../lib/coords'
import { categoryName } from '../lib/data'
import type { CustomPin } from '../lib/storage'
import type { Fraction, Item } from '../lib/types'
import { categoryStyle } from './categories'

/*
 * Each marker hangs from a zero-size anchor placed at its fraction of the
 * stage, so the anchor is the exact image point at every zoom and size.
 */

export function CustomMarker({
  pin,
  selected,
  onSelect,
}: {
  pin: CustomPin
  selected: boolean
  onSelect: () => void
}) {
  return (
    <div data-pin className={`absolute size-0 hover:z-30 ${selected ? 'z-30' : 'z-20'}`} style={pinPosition(pin)}>
      <button
        type="button"
        aria-label={`${pin.name}, your pin${pin.done ? ', completed' : ''}`}
        aria-pressed={selected}
        onClick={onSelect}
        className="absolute bottom-0 left-0 flex w-max -translate-x-3.5 translate-y-0.5 cursor-pointer items-end gap-0.5 rounded"
      >
        {pin.done ? (
          <span className="mb-0.5 grid size-7 place-items-center rounded-full border-2 border-ink-950 bg-moss text-ink-950 shadow-md shadow-black/50">
            <Check size={15} strokeWidth={3.5} />
          </span>
        ) : (
          <MapPin size={28} strokeWidth={1.75} className="fill-parchment-200 text-ink-950 drop-shadow-[0_2px_2px_rgb(0_0_0/0.6)]" />
        )}
        <span
          className={`mb-1 max-w-40 truncate rounded px-1.5 py-0.5 text-[11px] font-medium ${
            selected ? 'bg-parchment-50 text-ink-950' : pin.done ? 'bg-ink-950/85 text-parchment-400' : 'bg-ink-950/85 text-parchment-50'
          } ${pin.done ? 'line-through' : ''}`}
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

export function OfficialMarker({
  item,
  at,
  done,
  selected,
  onSelect,
}: {
  item: Item
  at: Fraction
  done: boolean
  selected: boolean
  onSelect: () => void
}) {
  const { icon: Icon, color } = categoryStyle(item.cat)
  return (
    <div data-pin className={`absolute size-0 hover:z-30 ${selected ? 'z-30' : 'z-10'}`} style={pinPosition(at)}>
      <button
        type="button"
        title={item.name}
        aria-label={`${item.name}, ${categoryName(item.cat)}${done ? ', completed' : ''}`}
        aria-pressed={selected}
        onClick={onSelect}
        style={{ borderColor: done ? undefined : color, color: done ? undefined : color }}
        className={`absolute -top-3.5 -left-3.5 grid size-7 cursor-pointer place-items-center rounded-full border-2 shadow-md shadow-black/50 transition-transform hover:scale-115 ${
          done ? 'border-moss bg-ink-800/80 text-moss opacity-70' : 'bg-ink-950'
        } ${selected ? 'scale-125 opacity-100 ring-2 ring-parchment-50' : ''}`}
      >
        {done ? <Check size={14} strokeWidth={3.5} /> : <Icon size={15} strokeWidth={2.25} />}
      </button>
    </div>
  )
}
