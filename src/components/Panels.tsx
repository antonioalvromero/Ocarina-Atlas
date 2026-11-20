import { Check, ChevronDown, Eye, EyeOff, Moon, Trash2, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ageFilterSlot,
  hiddenCategoriesSlot,
  officialDoneSlot,
  officialRevealedSlot,
  officialVisibleSlot,
  ownedPrereqsSlot,
  prereqFilterEnabledSlot,
  removePin,
  setInList,
  spoilerFreeSlot,
  toggleInList,
  updatePin,
  useStored,
  write,
  type CustomPin,
} from '../lib/storage'
import { categoryName, dataset } from '../lib/data'
import { useI18n, type TranslationKey } from '../lib/i18n'
import { PIN_TYPES, pinTypeLabel } from '../lib/pinTypes'
import {
  ALL_PREREQUISITE_KEYS,
  expandOwnedRequirements,
  isRequirementClauseMet,
  meetsItemRequirements,
  type RequirementEvalOptions,
} from '../lib/prerequisites'
import type { AgeFilter, Item } from '../lib/types'
import { categoryStyle } from './categories'
import { GearChecklistModal } from './GearChecklistModal'
import { ItemDetail } from './ItemDetail'
import { RichText } from './RichText'

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

const PIN_TYPE_KEYS = new Set<string>(PIN_TYPES.map((p) => p.key))

function translatedPinTypeLabel(type: string, t: (key: TranslationKey) => string): string {
  if (PIN_TYPE_KEYS.has(type)) {
    return t(`pin.type.${type}` as TranslationKey)
  }
  return pinTypeLabel(type)
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
  const { t } = useI18n()
  const ref = useRevealWhen(selected)
  const [name, setName] = useState(pin.name)
  const { icon: Icon, color } = categoryStyle(pin.type)

  function changeType(type: string) {
    // A default name follows the type. One you wrote stays.
    const isDefault = pin.name === pinTypeLabel(pin.type) || pin.name === translatedPinTypeLabel(pin.type, t)
    const next = isDefault ? translatedPinTypeLabel(type, t) : pin.name
    updatePin(placeId, mapId, pin.id, { type, name: next })
    setName(next)
  }

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
          label={t('panel.markItemCompleted', { name: pin.name })}
          onToggle={() => updatePin(placeId, mapId, pin.id, { done: !pin.done })}
        />
        <Icon size={14} style={{ color }} className="shrink-0" aria-hidden />
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
        <label className="flex items-center gap-2 px-2 pb-1.5 text-xs text-parchment-400">
          {t('panel.type')}
          <select
            value={pin.type}
            onChange={(event) => changeType(event.target.value)}
            className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-950 px-1.5 py-1 text-sm text-parchment-50 outline-none focus:border-parchment-400"
          >
            {PIN_TYPES.map(({ key }) => (
              <option key={key} value={key}>
                {translatedPinTypeLabel(key, t)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && (
        <form onSubmit={rename} className="flex gap-1.5 px-2 pb-2">
          <input
            aria-label={t('panel.renameItem', { name: pin.name })}
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
            {t('common.rename')}
          </button>
          <button
            type="button"
            aria-label={t('panel.deleteItem', { name: pin.name })}
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
  title,
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
  const { t } = useI18n()
  const done = pins.filter((pin) => pin.done).length
  if (hideWhenEmpty && pins.length === 0) return null
  return (
    <Section
      title={title ?? t('place.yourPins')}
      aside={pins.length > 0 && <span className="text-xs text-parchment-400 tabular-nums">{done}/{pins.length}</span>}
    >
      {pins.length === 0 ? (
        <p className="text-sm text-parchment-400">{t('place.clickMapToAdd')}</p>
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

const ageLabelKeys: Record<string, TranslationKey> = {
  child: 'panel.ageChild',
  adult: 'panel.ageAdult',
  both: 'panel.ageChildOrAdult',
}

type ChipTone = 'neutral' | 'met' | 'missing'

const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  neutral: 'border-ink-600 bg-ink-800 text-parchment-200',
  met: 'border-moss/55 bg-moss/15 text-moss',
  missing: 'border-ember/60 bg-ember/10 text-ember',
}

function DetailChip({ children, tone = 'neutral', title }: { children: ReactNode; tone?: ChipTone; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${CHIP_TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  )
}

export function SpoilerShieldBadgesAndHint({
  item,
  ownedExpanded,
  evalOptions,
  onRevealSolution,
}: {
  item: Item
  ownedExpanded?: ReadonlySet<string>
  evalOptions?: Pick<RequirementEvalOptions, 'collectedBeanIds' | 'beanAutoSynced'>
  onRevealSolution: () => void
}) {
  const { t, tCategory, tRequirement, tItemHint } = useI18n()
  const ageKey = item.age ? ageLabelKeys[item.age] : undefined
  const requirementOptions = evalOptions ? { ...evalOptions, item } : { item }
  return (
    <div className="space-y-3 px-2 pt-1 pb-3 text-sm leading-relaxed text-parchment-200">
      <div className="flex flex-wrap gap-1">
        <DetailChip>{tCategory(item.cat, categoryName(item.cat))}</DetailChip>
        {item.age && <DetailChip>{ageKey ? t(ageKey) : item.age}</DetailChip>}
        {item.night && (
          <DetailChip>
            <Moon size={11} /> {t('item.nightOnly')}
          </DetailChip>
        )}
      </div>
      {item.hint && (
        <div className="rounded-md border-l-2 border-parchment-400 bg-ink-800 px-3 py-2">
          <p className="text-[11px] font-medium tracking-wide text-parchment-400 uppercase">{t('item.hint')}</p>
          <RichText text={tItemHint(item.id, item.hint)} />
        </div>
      )}
      {item.requires.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-wide text-parchment-400 uppercase">{t('item.requires')}</p>
          <ul className="flex flex-wrap gap-1">
            {item.requires.map((requirement, index) => {
              const met = ownedExpanded
                ? isRequirementClauseMet(requirement, ownedExpanded, requirementOptions)
                : null
              return (
                <li key={index}>
                  <DetailChip
                    tone={met === true ? 'met' : met === false ? 'missing' : 'neutral'}
                    title={met === false ? t('filter.missingReqs') : undefined}
                  >
                    {met === true && <Check size={10} strokeWidth={3} aria-hidden />}
                    {tRequirement(requirement)}
                  </DetailChip>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <div className="rounded-md border border-[#e8c04a]/40 bg-ink-950/75 px-3 py-2.5 text-xs text-parchment-200">
        <p className="text-parchment-400">{t('spoiler.hiddenNotice')}</p>
        <button
          type="button"
          onClick={onRevealSolution}
          className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded border border-[#e8c04a]/60 bg-[#e8c04a]/15 px-2.5 py-1 text-xs font-medium text-[#f3d473] transition-colors hover:border-[#e8c04a] hover:bg-[#e8c04a]/25 hover:text-parchment-50"
        >
          <Eye size={12} aria-hidden />
          <span>{t('spoiler.revealSolution')}</span>
        </button>
      </div>
    </div>
  )
}

function ItemRow({
  item,
  done,
  selected,
  onSelect,
  ownedExpanded,
  evalOptions,
}: {
  item: Item
  done: boolean
  selected: boolean
  onSelect: () => void
  ownedExpanded?: ReadonlySet<string>
  evalOptions?: Pick<RequirementEvalOptions, 'collectedBeanIds' | 'beanAutoSynced'>
}) {
  const { t, tItemName } = useI18n()
  const ref = useRevealWhen(selected)
  const { icon: Icon, color } = categoryStyle(item.cat)
  const revealed = useStored(officialRevealedSlot).includes(item.id)
  const spoilerFree = useStored(spoilerFreeSlot)
  const [solutionRevealed, setSolutionRevealed] = useState(false)
  useEffect(() => {
    setSolutionRevealed(false)
  }, [item.id])
  const itemName = tItemName(item.id, item.name)
  return (
    <li ref={ref} className={`rounded-md ${selected ? 'bg-ink-900 ring-1 ring-ink-600' : ''}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <DoneBox done={done} label={t('panel.markItemCompleted', { name: itemName })} onToggle={() => toggleInList(officialDoneSlot, item.id)} />
        <Icon size={14} style={{ color }} className="shrink-0" aria-hidden />
        <button
          type="button"
          aria-expanded={selected}
          onClick={onSelect}
          className={`flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 text-left text-sm hover:text-parchment-50 ${
            done ? 'text-parchment-600 line-through' : 'text-parchment-200'
          }`}
        >
          <span className={selected ? '' : 'truncate'}>{itemName}</span>
          <ChevronDown size={14} className={`shrink-0 text-parchment-600 ${selected ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {selected &&
        (spoilerFree && !done && !solutionRevealed ? (
          <SpoilerShieldBadgesAndHint
            item={item}
            ownedExpanded={ownedExpanded}
            evalOptions={evalOptions}
            onRevealSolution={() => setSolutionRevealed(true)}
          />
        ) : (
          <>
            <ItemDetail item={item} ownedExpanded={ownedExpanded} evalOptions={evalOptions} />
            {spoilerFree && !done && solutionRevealed && (
              <div className="px-2 pb-2">
                <button
                  type="button"
                  onClick={() => setSolutionRevealed(false)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-parchment-200 transition-colors hover:border-parchment-400 hover:text-parchment-50"
                >
                  <EyeOff size={12} aria-hidden />
                  <span>{t('spoiler.hideSolution')}</span>
                </button>
              </div>
            )}
          </>
        ))}
      {selected && revealed && (
        <div className="flex justify-end px-2 pb-2">
          <button
            type="button"
            onClick={() => setInList(officialRevealedSlot, item.id, false)}
            className="flex cursor-pointer items-center gap-1 rounded border border-ink-600 px-2 py-1 text-xs text-parchment-200 hover:border-parchment-400"
          >
            <EyeOff size={13} /> {t('panel.hideAgain')}
          </button>
        </div>
      )}
    </li>
  )
}

function ItemList({
  items,
  done,
  selectedId,
  onSelect,
  ownedExpanded,
  evalOptions,
}: {
  items: Item[]
  done: Set<string>
  selectedId: string | null
  onSelect: (item: Item) => void
  ownedExpanded?: ReadonlySet<string>
  evalOptions?: Pick<RequirementEvalOptions, 'collectedBeanIds' | 'beanAutoSynced'>
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
          ownedExpanded={ownedExpanded}
          evalOptions={evalOptions}
        />
      ))}
    </ul>
  )
}

const ageOptions: { value: AgeFilter; key: TranslationKey }[] = [
  { value: 'child', key: 'panel.ageChild' },
  { value: 'adult', key: 'panel.ageAdult' },
  { value: 'both', key: 'panel.ageBoth' },
]

function AgeSelector({ age }: { age: AgeFilter }) {
  const { t } = useI18n()
  return (
    <div role="group" aria-label={t('panel.filterByAge')} className="mb-2 flex overflow-hidden rounded border border-ink-600">
      {ageOptions.map(({ value, key }) => (
        <button
          key={value}
          type="button"
          aria-pressed={value === age}
          onClick={() => write(ageFilterSlot, value)}
          className={`flex-1 cursor-pointer px-2 py-1 text-xs ${
            value === age ? 'bg-parchment-200 font-medium text-ink-950' : 'text-parchment-200 hover:bg-ink-700'
          }`}
        >
          {t(key)}
        </button>
      ))}
    </div>
  )
}

function CategoryFilter({ items, hidden }: { items: Item[]; hidden: string[] }) {
  const { t, tCategory } = useI18n()
  return (
    <div role="group" aria-label={t('panel.filterByCategory')} className="mb-2 flex flex-wrap gap-1">
      {dataset.categories.map((category) => {
        const count = items.filter((item) => item.cat === category.key).length
        if (count === 0) return null
        const { icon: Icon, color } = categoryStyle(category.key)
        const on = !hidden.includes(category.key)
        const label = tCategory(category.key, category.name)
        return (
          <button
            key={category.key}
            type="button"
            aria-pressed={on}
            title={label}
            onClick={() => toggleInList(hiddenCategoriesSlot, category.key)}
            className={`flex cursor-pointer items-center gap-1 rounded border px-1.5 py-1 text-[11px] tabular-nums ${
              on ? 'border-ink-600 bg-ink-800 text-parchment-200' : 'border-ink-700 bg-ink-950/40 text-parchment-600'
            }`}
          >
            <Icon size={12} style={{ color: on ? color : undefined }} aria-hidden />
            <span>{label}</span>
            <span className="opacity-70">{count}</span>
          </button>
        )
      })}
    </div>
  )
}

export function OfficialToggle({ on }: { on: boolean }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => write(officialVisibleSlot, !on)}
      className="flex cursor-pointer items-center gap-2 text-xs text-parchment-200"
    >
      {t('panel.showOfficialPins')}
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? 'bg-moss' : 'bg-ink-600'}`}>
        <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-parchment-50 transition-transform ${on ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}

export function SpoilerFreeToggle({ on }: { on: boolean }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => write(spoilerFreeSlot, !on)}
      className="mb-2.5 flex cursor-pointer items-center gap-2 text-xs text-parchment-200"
    >
      <span>{t('filter.spoilerFree')}</span>
      <span className={`relative h-4.5 w-8 rounded-full transition-colors ${on ? 'bg-moss' : 'bg-ink-600'}`}>
        <span className={`absolute top-0.5 left-0.5 size-3.5 rounded-full bg-parchment-50 transition-transform ${on ? 'translate-x-3.5' : ''}`} />
      </span>
    </button>
  )
}

/** What the official section lists while the rest stay hidden. */
export function RevealedList({
  items,
  done,
  selectedId,
  onSelect,
  ownedExpanded,
  evalOptions,
}: {
  items: Item[]
  done: Set<string>
  selectedId: string | null
  onSelect: (item: Item) => void
  ownedExpanded?: ReadonlySet<string>
  evalOptions?: Pick<RequirementEvalOptions, 'collectedBeanIds' | 'beanAutoSynced'>
}) {
  if (items.length === 0) return null
  return (
    <ItemList
      items={items}
      done={done}
      selectedId={selectedId}
      onSelect={onSelect}
      ownedExpanded={ownedExpanded}
      evalOptions={evalOptions}
    />
  )
}

export function OfficialList({
  onMap,
  unplaced,
  age,
  hidden,
  done,
  selectedId,
  onSelect,
  evalOptions,
}: {
  onMap: Item[]
  unplaced: Item[]
  age: AgeFilter
  hidden: string[]
  done: Set<string>
  selectedId: string | null
  onSelect: (item: Item) => void
  evalOptions?: Pick<RequirementEvalOptions, 'collectedBeanIds' | 'beanAutoSynced'>
}) {
  const { t } = useI18n()
  const prereqFilterEnabled = useStored(prereqFilterEnabledSlot)
  const ownedPrereqs = useStored(ownedPrereqsSlot)
  const [gearOpen, setGearOpen] = useState(false)

  const ownedCount = useMemo(() => {
    const ownedSet = new Set(ownedPrereqs)
    return ALL_PREREQUISITE_KEYS.filter((key) => ownedSet.has(key)).length
  }, [ownedPrereqs])
  const ownedExpanded = useMemo(() => expandOwnedRequirements(ownedPrereqs), [ownedPrereqs])
  const detailOwnedExpanded =
    prereqFilterEnabled || ownedPrereqs.length > 0 ? ownedExpanded : undefined

  const shown = (items: Item[]) =>
    items.filter(
      (item) =>
        !hidden.includes(item.cat) &&
        (!prereqFilterEnabled || meetsItemRequirements(item, ownedExpanded, evalOptions)),
    )
  const mapped = shown(onMap)
  const listed = shown(unplaced)
  return (
    <>
      <AgeSelector age={age} />
      <CategoryFilter items={[...onMap, ...unplaced]} hidden={hidden} />
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={prereqFilterEnabled}
          onClick={() => write(prereqFilterEnabledSlot, !prereqFilterEnabled)}
          className="flex cursor-pointer items-center gap-2 text-xs text-parchment-200"
        >
          <span>{t('filter.prereqOnly')}</span>
          <span
            className={`relative h-4.5 w-8 rounded-full transition-colors ${
              prereqFilterEnabled ? 'bg-moss' : 'bg-ink-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-3.5 rounded-full bg-parchment-50 transition-transform ${
                prereqFilterEnabled ? 'translate-x-3.5' : ''
              }`}
            />
          </span>
        </button>
        <div className="flex items-center gap-2">
          {prereqFilterEnabled && onMap.length + unplaced.length > 0 && (
            <span className="text-[11px] text-[#f3d473] tabular-nums">
              {t('filter.reachableCount', { count: mapped.length + listed.length })}
            </span>
          )}
          <button
            type="button"
            onClick={() => setGearOpen(true)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] font-medium text-parchment-200 transition-colors hover:border-[#e8c04a]/70 hover:text-parchment-50"
          >
            <Wrench size={11} className="text-[#e8c04a]" aria-hidden />
            <span>{t('filter.gearButton')}</span>
            <span className="text-parchment-400 tabular-nums">
              ({ownedCount}/{ALL_PREREQUISITE_KEYS.length})
            </span>
          </button>
        </div>
      </div>
      {mapped.length > 0 && (
        <ItemList
          items={mapped}
          done={done}
          selectedId={selectedId}
          onSelect={onSelect}
          ownedExpanded={detailOwnedExpanded}
          evalOptions={evalOptions}
        />
      )}
      {listed.length > 0 && (
        <>
          <h3 className="mt-3 mb-1 text-[11px] font-medium tracking-wide text-parchment-400 uppercase">
            {t('panel.notOnMap')}
          </h3>
          <ItemList
            items={listed}
            done={done}
            selectedId={selectedId}
            onSelect={onSelect}
            ownedExpanded={detailOwnedExpanded}
            evalOptions={evalOptions}
          />
        </>
      )}
      {mapped.length === 0 && listed.length === 0 && (
        <p className="text-sm text-parchment-400">{t('panel.nothingToShow')}</p>
      )}
      <GearChecklistModal open={gearOpen} onClose={() => setGearOpen(false)} />
    </>
  )
}
