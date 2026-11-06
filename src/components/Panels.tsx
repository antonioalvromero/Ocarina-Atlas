import { Check, ChevronDown, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  hiddenCategoriesSlot,
  officialDoneSlot,
  officialVisibleSlot,
  removePin,
  toggleInList,
  updatePin,
  write,
  type CustomPin,
} from '../lib/storage'
import { dataset } from '../lib/data'
import type { Item } from '../lib/types'
import { categoryStyle } from './categories'
import { ItemDetail } from './ItemDetail'

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-ink-700 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-serif text-base text-parchment-50">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function DoneBox({ done, label, onToggle }: { done: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={onToggle}
      className={`grid size-5 shrink-0 cursor-pointer place-items-center rounded border ${
        done ? 'border-moss bg-moss text-ink-950' : 'border-parchment-600 hover:border-parchment-200'
      }`}
    >
      {done && <Check size={13} strokeWidth={3.5} />}
    </button>
  )
}

/** Keeps the expanded row visible when it was selected from the map. */
function useRevealWhen(active: boolean) {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return ref
}

function CustomPinRow({
  pin,
  placeId,
  mapId,
  selected,
  onSelect,
}: {
  pin: CustomPin
  placeId: string
  mapId: string
  selected: boolean
  onSelect: () => void
}) {
  const ref = useRevealWhen(selected)
  const [name, setName] = useState(pin.name)

  function rename(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed) updatePin(placeId, mapId, pin.id, { name: trimmed })
    else setName(pin.name)
  }

  return (
    <li ref={ref} className={`rounded-md ${selected ? 'bg-ink-800' : ''}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <DoneBox
          done={pin.done}
          label={`Mark ${pin.name} completed`}
          onToggle={() => updatePin(placeId, mapId, pin.id, { done: !pin.done })}
        />
        <button
          type="button"
          aria-expanded={selected}
          onClick={onSelect}
          className={`min-w-0 flex-1 cursor-pointer truncate text-left text-sm hover:text-parchment-50 ${
            pin.done ? 'text-parchment-600 line-through' : 'text-parchment-200'
          }`}
        >
          {pin.name}
        </button>
      </div>
      {selected && (
        <form onSubmit={rename} className="flex gap-1.5 px-2 pb-2">
          <input
            aria-label={`Rename ${pin.name}`}
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-950 px-2 py-1 text-sm text-parchment-50 outline-none focus:border-parchment-400"
          />
          <button
            type="submit"
            disabled={!name.trim() || name.trim() === pin.name}
            className="rounded bg-parchment-200 px-2 text-xs font-medium text-ink-950 hover:bg-parchment-50 disabled:opacity-40"
          >
            Rename
          </button>
          <button
            type="button"
            aria-label={`Delete ${pin.name}`}
            onClick={() => removePin(placeId, mapId, pin.id)}
            className="grid w-8 place-items-center rounded border border-ink-600 text-ember hover:border-ember"
          >
            <Trash2 size={14} />
          </button>
        </form>
      )}
    </li>
  )
}

export function CustomPinList({
  pins,
  placeId,
  mapId,
  selectedId,
  onSelect,
  title = 'Your pins',
  hideWhenEmpty = false,
}: {
  pins: CustomPin[]
  placeId: string
  mapId: string
  selectedId: string | null
  onSelect: (pin: CustomPin) => void
  title?: string
  hideWhenEmpty?: boolean
}) {
  const done = pins.filter((pin) => pin.done).length
  if (hideWhenEmpty && pins.length === 0) return null
  return (
    <Section
      title={title}
      aside={pins.length > 0 && <span className="text-xs text-parchment-400 tabular-nums">{done}/{pins.length}</span>}
    >
      {pins.length === 0 ? (
        <p className="text-sm text-parchment-400">Click the map to add a pin.</p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {pins.map((pin) => (
            <CustomPinRow
              key={pin.id}
              pin={pin}
              placeId={placeId}
              mapId={mapId}
              selected={pin.id === selectedId}
              onSelect={() => onSelect(pin)}
            />
          ))}
        </ul>
      )}
    </Section>
  )
}

function ItemRow({
  item,
  done,
  selected,
  onSelect,
}: {
  item: Item
  done: boolean
  selected: boolean
  onSelect: () => void
}) {
  const ref = useRevealWhen(selected)
  const { icon: Icon, color } = categoryStyle(item.cat)
  return (
    <li ref={ref} className={`rounded-md ${selected ? 'bg-ink-900 ring-1 ring-ink-600' : ''}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <DoneBox done={done} label={`Mark ${item.name} completed`} onToggle={() => toggleInList(officialDoneSlot, item.id)} />
        <Icon size={14} style={{ color }} className="shrink-0" aria-hidden />
        <button
          type="button"
          aria-expanded={selected}
          onClick={onSelect}
          className={`flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 text-left text-sm hover:text-parchment-50 ${
            done ? 'text-parchment-600 line-through' : 'text-parchment-200'
          }`}
        >
          <span className={selected ? '' : 'truncate'}>{item.name}</span>
          <ChevronDown size={14} className={`shrink-0 text-parchment-600 ${selected ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {selected && <ItemDetail item={item} />}
    </li>
  )
}

function ItemList({
  items,
  done,
  selectedId,
  onSelect,
}: {
  items: Item[]
  done: Set<string>
  selectedId: string | null
  onSelect: (item: Item) => void
}) {
  return (
    <ul className="-mx-2 space-y-0.5">
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          done={done.has(item.id)}
          selected={item.id === selectedId}
          onSelect={() => onSelect(item)}
        />
      ))}
    </ul>
  )
}

function CategoryFilter({ items, hidden }: { items: Item[]; hidden: string[] }) {
  return (
    <div role="group" aria-label="Filter by category" className="mb-2 flex flex-wrap gap-1">
      {dataset.categories.map((category) => {
        const count = items.filter((item) => item.cat === category.key).length
        if (count === 0) return null
        const { icon: Icon, color } = categoryStyle(category.key)
        const on = !hidden.includes(category.key)
        return (
          <button
            key={category.key}
            type="button"
            aria-pressed={on}
            title={category.name}
            onClick={() => toggleInList(hiddenCategoriesSlot, category.key)}
            className={`flex cursor-pointer items-center gap-1 rounded border px-1.5 py-1 text-[11px] tabular-nums ${
              on ? 'border-ink-600 bg-ink-800 text-parchment-200' : 'border-ink-700 text-parchment-600 opacity-60'
            }`}
          >
            <Icon size={12} style={{ color: on ? color : undefined }} aria-hidden />
            <span>{category.name}</span>
            <span className="opacity-70">{count}</span>
          </button>
        )
      })}
    </div>
  )
}

export function OfficialToggle({ on }: { on: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => write(officialVisibleSlot, !on)}
      className="flex cursor-pointer items-center gap-2 text-xs text-parchment-200"
    >
      Show official pins
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-moss' : 'bg-ink-600'}`}>
        <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-parchment-50 transition-transform ${on ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}

export function OfficialList({
  onMap,
  unplaced,
  hidden,
  done,
  selectedId,
  onSelect,
}: {
  onMap: Item[]
  unplaced: Item[]
  hidden: string[]
  done: Set<string>
  selectedId: string | null
  onSelect: (item: Item) => void
}) {
  const shown = (items: Item[]) => items.filter((item) => !hidden.includes(item.cat))
  const mapped = shown(onMap)
  const listed = shown(unplaced)
  return (
    <>
      <CategoryFilter items={[...onMap, ...unplaced]} hidden={hidden} />
      {mapped.length > 0 && (
        <ItemList items={mapped} done={done} selectedId={selectedId} onSelect={onSelect} />
      )}
      {listed.length > 0 && (
        <>
          <h3 className="mt-3 mb-1 text-[11px] font-medium tracking-wide text-parchment-400 uppercase">
            Not on a map
          </h3>
          <ItemList items={listed} done={done} selectedId={selectedId} onSelect={onSelect} />
        </>
      )}
      {mapped.length === 0 && listed.length === 0 && (
        <p className="text-sm text-parchment-400">Nothing to show on this map.</p>
      )}
    </>
  )
}
