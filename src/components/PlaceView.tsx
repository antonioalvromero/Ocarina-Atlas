import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Check, EyeOff, Info, Link2, Maximize2, Minimize2, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { dataset, formatFloorLabel, isUnplaced, itemsOfPlace, matchesAge, startMapOf } from '../lib/data'
import { floorToGrid, gridPoint, layoutFloors } from '../lib/floorGrid'
import { useI18n, type TranslationKey } from '../lib/i18n'
import { findMerge, type Merge } from '../lib/merge'
import { OTHER_PIN, PIN_TYPES, pinTypeLabel } from '../lib/pinTypes'
import {
  expandOwnedRequirements,
  meetsItemRequirements,
  type RequirementEvalOptions,
} from '../lib/prerequisites'
import {
  addPin,
  ageFilterSlot,
  hiddenCategoriesSlot,
  hideDoneSlot,
  itemCountVisibleSlot,
  officialDoneSlot,
  officialRevealedSlot,
  officialVisibleSlot,
  ownedPrereqsSlot,
  pinsSlot,
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
import type { Fraction, Item, Place, PlaceMap } from '../lib/types'
import { useFullscreenMap } from '../lib/useFullscreenMap'
import {
  getLichiiPositionSnapshot,
  isLiveMemoryState,
  subscribeLichiiPosition,
  useLichiiTracker,
} from '../lib/useLichiiTracker'
import { categoryStyle } from './categories'
import { CreditsModal } from './CreditsModal'
import { FloorGrid, type FloorDraft } from './FloorGrid'
import { ItemDetail } from './ItemDetail'
import { LanguageSelector } from './LanguageSelector'
import { LichiiStatusPanel } from './LichiiStatusPanel'
import { MapViewport, type MapViewportHandle, type Projection } from './MapViewport'
import { MergeNotice } from './MergeNotice'
import { NewPinPopover } from './NewPinPopover'
import {
  CustomPinList,
  OfficialList,
  OfficialToggle,
  RevealedList,
  Section,
  SpoilerFreeToggle,
  SpoilerShieldBadgesAndHint,
} from './Panels'
import { CustomMarker, DraftMarker, MergeTrail, OfficialMarker } from './Pins'
import { LivePlayerPin } from './PlayerPin'
import { QuickSearchModal, type QuickSearchTarget } from './QuickSearchModal'

type Selection = { kind: 'custom'; id: string; mapId: string } | { kind: 'item'; id: string } | null

const PIN_TYPE_KEYS = new Set<string>(PIN_TYPES.map((p) => p.key))

function translatedPinTypeLabel(type: string, t: (key: TranslationKey) => string): string {
  if (PIN_TYPE_KEYS.has(type)) {
    return t(`pin.type.${type}` as TranslationKey)
  }
  return pinTypeLabel(type)
}

function translateFloorLabel(labelOrId: string, t: (key: TranslationKey) => string): string {
  const formatted = formatFloorLabel(labelOrId)
  if (formatted === 'Child') return t('floor.child')
  if (formatted === 'Adult') return t('floor.adult')
  if (formatted === 'Main') return t('floor.main')
  return formatted
}

function useOfficialProgress(items: Item[]) {
  const doneIds = useStored(officialDoneSlot)
  const done = useMemo(() => new Set(doneIds), [doneIds])
  return { done, count: items.filter((item) => done.has(item.id)).length }
}

function HideDoneToggle({ on }: { on: boolean }) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => write(hideDoneSlot, !on)}
      className="mb-2.5 flex cursor-pointer items-center gap-2 text-xs text-parchment-200"
    >
      <span>{t('filter.hideCompleted')}</span>
      <span className={`relative h-4.5 w-8 rounded-full transition-colors ${on ? 'bg-moss' : 'bg-ink-600'}`}>
        <span className={`absolute top-0.5 left-0.5 size-3.5 rounded-full bg-parchment-50 transition-transform ${on ? 'translate-x-3.5' : ''}`} />
      </span>
    </button>
  )
}

function ItemCount({ placeId, progress, total }: { placeId: string; progress: number; total: number }) {
  const { t } = useI18n()
  const shown = useStored(itemCountVisibleSlot).includes(placeId)
  return (
    <>
      {' · '}
      {shown && <span className="tabular-nums">{t('place.itemsCount', { done: progress, total })} · </span>}
      <button
        type="button"
        onClick={() => toggleInList(itemCountVisibleSlot, placeId)}
        className="cursor-pointer underline hover:text-parchment-50"
      >
        {shown ? t('place.hideCount') : t('place.showItemCount')}
      </button>
    </>
  )
}

function CopyPinLinkButton({ placeSlug, itemId }: { placeSlug: string; itemId: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = useCallback(async () => {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/${placeSlug}?pin=${encodeURIComponent(itemId)}`
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        ok = true
      }
    } catch {
      // Fall through to execCommand fallback below.
    }
    if (!ok && typeof document !== 'undefined') {
      try {
        const ta = document.createElement('textarea')
        ta.value = url
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    if (ok) {
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    }
  }, [placeSlug, itemId])

  const label = copied ? t('search.linkCopied') || 'Link copied' : t('search.copyLink') || 'Copy link'
  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className={`inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
        copied
          ? 'border-moss/60 bg-moss/15 text-moss'
          : 'border-ink-600 bg-ink-800 text-parchment-200 hover:border-parchment-400 hover:text-parchment-50'
      }`}
    >
      {copied ? <Check size={12} strokeWidth={3} /> : <Link2 size={12} />}
      {label}
    </button>
  )
}

function Sidebar({
  place,
  progress,
  total,
  onEnterFullscreen,
  onOpenSearch,
  children,
}: {
  place: Place
  progress: number
  total: number
  onEnterFullscreen?: () => void
  onOpenSearch?: () => void
  children: ReactNode
}) {
  const { t, tPlace, tRegion, tPlaceIntro } = useI18n()
  const [creditsOpen, setCreditsOpen] = useState(false)
  return (
    <aside className="hyrule-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto border-ink-700 bg-ink-900 max-lg:border-t max-lg:landscape:w-72 max-lg:landscape:flex-none max-lg:landscape:border-t-0 max-lg:landscape:border-l lg:w-96 lg:flex-none lg:border-l">
      <header className="px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <Link to="/" className="inline-flex items-center gap-1 text-xs text-parchment-400 hover:text-parchment-50">
            <ArrowLeft size={13} /> {t('place.atlas')}
          </Link>
          <div className="flex items-center gap-1.5">
            {onOpenSearch && (
              <button
                type="button"
                onClick={onOpenSearch}
                aria-label={t('search.open') || 'Search'}
                title={t('search.open') || 'Search'}
                className="inline-flex cursor-pointer items-center gap-1 rounded border border-ink-600 bg-ink-800/90 px-2 py-0.5 text-xs font-medium text-parchment-200 transition-colors hover:border-parchment-400 hover:bg-ink-700 hover:text-parchment-50"
              >
                <Search size={12} className="text-[#e8c04a]" aria-hidden />
                <kbd className="rounded border border-ink-600 bg-ink-950/80 px-1 py-px font-sans text-[10px] text-parchment-400 max-sm:hidden">
                  Ctrl+K
                </kbd>
              </button>
            )}
            <LanguageSelector />
            {onEnterFullscreen && (
              <button
                type="button"
                onClick={onEnterFullscreen}
                aria-label={t('map.enterFullscreen')}
                title={t('map.fullscreenMap')}
                className="inline-flex cursor-pointer items-center gap-1 rounded border border-ink-600 bg-ink-800/90 px-2 py-0.5 text-xs font-medium text-parchment-200 transition-colors hover:border-parchment-400 hover:bg-ink-700 hover:text-parchment-50"
              >
                <Maximize2 size={12} />
                {t('map.fullscreen')}
              </button>
            )}
          </div>
        </div>
        <h1 className="mt-1.5 font-serif text-2xl leading-tight text-parchment-50">{tPlace(place.id, place.name)}</h1>
        <p className="mt-0.5 text-xs text-parchment-400">
          <span className={place.kind === 'dungeon' ? 'text-ember' : ''}>
            {t('place.inRegion', {
              kind: t(place.kind === 'dungeon' ? 'world.dungeon' : 'world.zone'),
              region: tRegion(place.region),
            })}
          </span>
          {total > 0 && <ItemCount placeId={place.id} progress={progress} total={total} />}
        </p>
        <details className="mt-2 text-sm leading-relaxed text-parchment-200">
          <summary className="cursor-pointer text-xs text-parchment-400 hover:text-parchment-50">{t('place.about')}</summary>
          <p className="mt-1">{tPlaceIntro(place.id, place.intro)}</p>
        </details>
      </header>
      {children}
      <footer className="mt-auto border-t border-ink-700 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setCreditsOpen(true)}
          aria-label={t('credits.title')}
          className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-parchment-400 transition-colors hover:text-parchment-50"
        >
          <Info size={13} className="text-[#e8c04a]" aria-hidden />
          <span>{t('credits.button')}</span>
        </button>
      </footer>
      <CreditsModal open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </aside>
  )
}

function MapSwitcher({
  maps,
  current,
  playerMapId,
  playerLive = true,
  onChange,
  allFloors,
  inline = false,
  isFullscreen = false,
}: {
  maps: PlaceMap[]
  current: string | null
  playerMapId?: string | null
  playerLive?: boolean
  onChange: (id: string) => void
  allFloors?: { active: boolean; onShow: () => void }
  inline?: boolean
  isFullscreen?: boolean
}) {
  const { t } = useI18n()
  return (
    <div
      role="group"
      aria-label={t('place.chooseMap')}
      style={
        !inline && isFullscreen
          ? {
              top: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
              left: 'calc(0.75rem + env(safe-area-inset-left, 0px))',
            }
          : undefined
      }
      className={
        inline
          ? 'pointer-events-auto flex max-w-[calc(100vw-1.5rem)] overflow-x-auto overflow-y-hidden rounded-lg border border-ink-600 bg-ink-900/95 shadow-lg'
          : 'absolute top-3 left-3 z-30 flex max-w-[calc(100%-8.5rem)] overflow-x-auto overflow-y-hidden rounded-lg border border-ink-600 bg-ink-900/95 shadow-lg'
      }
    >
      {allFloors && (
        <button
          type="button"
          aria-pressed={allFloors.active}
          onClick={allFloors.onShow}
          className={`shrink-0 cursor-pointer px-3 py-1.5 text-sm ${
            allFloors.active ? 'bg-parchment-200 font-medium text-ink-950' : 'text-parchment-200 hover:bg-ink-700'
          }`}
        >
          {t('place.allFloors')}
        </button>
      )}
      {maps.map((map) => {
        const hasPlayer = playerMapId === map.id
        return (
          <button
            key={map.id}
            type="button"
            aria-pressed={map.id === current}
            onClick={() => onChange(map.id)}
            className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 px-3 py-1.5 text-sm ${
              map.id === current ? 'bg-parchment-200 font-medium text-ink-950' : 'text-parchment-200 hover:bg-ink-700'
            }`}
          >
            {hasPlayer && (
              <span
                title={playerLive ? t('place.linkOnFloor') : t('place.linkOnFloorSaved')}
                className={`size-2 rounded-full ${
                  map.id === current
                    ? playerLive
                      ? 'bg-ink-950'
                      : 'bg-ink-950/70'
                    : playerLive
                      ? 'bg-moss'
                      : 'bg-ember/80'
                }`}
              />
            )}
            {translateFloorLabel(map.label, t)}
          </button>
        )
      })}
    </div>
  )
}

function FloorPinList({
  place,
  map,
  selectedId,
  onSelect,
}: {
  place: Place
  map: PlaceMap
  selectedId: string | null
  onSelect: (pin: CustomPin) => void
}) {
  const { t } = useI18n()
  const pins = useStored(pinsSlot(place.id, map.id))
  return (
    <CustomPinList
      pins={pins}
      placeId={place.id}
      mapId={map.id}
      selectedId={selectedId}
      onSelect={onSelect}
      title={t('place.yourPinsFloor', { floor: translateFloorLabel(map.label, t) })}
      hideWhenEmpty
    />
  )
}

function PinPopoverFrame({
  at,
  projection,
  title,
  children,
}: {
  at: Fraction
  projection: Projection
  title: string
  children: ReactNode
}) {
  const { t } = useI18n()
  const width = Math.min(288, Math.max(220, projection.size.width - 24))
  const pt = projection.project(at)
  const left = Math.min(Math.max(12, pt.x - width / 2), Math.max(12, projection.size.width - width - 12))
  const placeAbove = pt.y > projection.size.height * 0.55
  const bottomOffset = Math.max(12, projection.size.height - pt.y + 18)
  const topOffset = Math.min(Math.max(12, pt.y + 18), Math.max(12, projection.size.height - 200))
  const maxHeight = placeAbove
    ? Math.max(140, Math.min(360, projection.size.height - bottomOffset - 12))
    : Math.max(140, Math.min(360, projection.size.height - topOffset - 12))
  const style = placeAbove
    ? { left, bottom: bottomOffset, width, maxHeight }
    : { left, top: topOffset, width, maxHeight }

  return (
    <div
      data-pin-popover
      role="dialog"
      aria-label={t('world.placeDetails', { name: title })}
      style={style}
      onWheel={(event) => event.stopPropagation()}
      className="hyrule-scrollbar pointer-events-auto absolute z-50 max-h-[min(65dvh,360px)] touch-pan-y overflow-y-auto overscroll-contain rounded-lg border border-ink-600 bg-ink-900/95 p-3 text-parchment-50 shadow-xl"
    >
      {children}
    </div>
  )
}

function ItemPinPopover({
  placeSlug,
  item,
  at,
  projection,
  done,
  revealed,
  ownedExpanded,
  evalOptions,
  onClose,
}: {
  placeSlug: string
  item: Item
  at: Fraction
  projection: Projection
  done: boolean
  revealed: boolean
  ownedExpanded?: ReadonlySet<string>
  evalOptions?: Pick<RequirementEvalOptions, 'collectedBeanIds' | 'beanAutoSynced'>
  onClose: () => void
}) {
  const { t, tItemName } = useI18n()
  const { icon: Icon, color } = categoryStyle(item.cat)
  const spoilerFree = useStored(spoilerFreeSlot)
  const [solutionRevealed, setSolutionRevealed] = useState(false)
  useEffect(() => {
    setSolutionRevealed(false)
  }, [item.id])
  const itemName = tItemName(item.id, item.name)
  return (
    <PinPopoverFrame at={at} projection={projection} title={itemName}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon size={15} style={{ color }} className="shrink-0" aria-hidden />
          <h2 className="truncate font-serif text-base leading-tight text-parchment-50">{itemName}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('panel.closePinInfo')}
          className="-mt-0.5 -mr-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-50"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={done}
          onClick={() => toggleInList(officialDoneSlot, item.id)}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium transition-colors ${
            done
              ? 'border-moss bg-moss/20 text-moss'
              : 'border-ink-600 bg-ink-800 text-parchment-200 hover:border-parchment-400 hover:text-parchment-50'
          }`}
        >
          <Check size={12} strokeWidth={3} />
          {done ? t('panel.completed') : t('panel.markCompleted')}
        </button>
        {revealed && (
          <button
            type="button"
            onClick={() => {
              setInList(officialRevealedSlot, item.id, false)
              onClose()
            }}
            className="inline-flex cursor-pointer items-center gap-1 rounded border border-ink-600 px-2 py-1 text-xs text-parchment-200 hover:border-parchment-400"
          >
            <EyeOff size={12} />
            {t('panel.hideAgain')}
          </button>
        )}
        <CopyPinLinkButton placeSlug={placeSlug} itemId={item.id} />
      </div>
      <div className="mt-2 -mx-2">
        {spoilerFree && !done && !solutionRevealed ? (
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
              <div className="px-2 pb-1">
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
        )}
      </div>
    </PinPopoverFrame>
  )
}

function CustomPinPopover({
  placeId,
  mapId,
  pinId,
  projection,
  projectAnchor,
  onClose,
}: {
  placeId: string
  mapId: string
  pinId: string
  projection: Projection
  projectAnchor?: (pin: CustomPin) => Fraction | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const pins = useStored(pinsSlot(placeId, mapId))
  const pin = pins.find((p) => p.id === pinId)
  const [name, setName] = useState(pin?.name ?? '')

  useEffect(() => {
    if (pin) setName(pin.name)
  }, [pin?.id, pin?.name])

  if (!pin) return null
  const anchor = projectAnchor ? projectAnchor(pin) : pin
  if (!anchor) return null
  const { icon: Icon, color } = categoryStyle(pin.type)

  function rename(event: FormEvent) {
    event.preventDefault()
    if (!pin) return
    const trimmed = name.trim()
    if (trimmed) updatePin(placeId, mapId, pin.id, { name: trimmed })
    else setName(pin.name)
  }

  return (
    <PinPopoverFrame at={anchor} projection={projection} title={pin.name}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon size={15} style={{ color }} className="shrink-0" aria-hidden />
          <h2 className="truncate font-serif text-base leading-tight text-parchment-50">{pin.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('panel.closePinInfo')}
          className="-mt-0.5 -mr-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-50"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={pin.done}
          onClick={() => updatePin(placeId, mapId, pin.id, { done: !pin.done })}
          className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded border px-2 py-1 text-xs font-medium transition-colors ${
            pin.done
              ? 'border-moss bg-moss/20 text-moss'
              : 'border-ink-600 bg-ink-800 text-parchment-200 hover:border-parchment-400 hover:text-parchment-50'
          }`}
        >
          <Check size={12} strokeWidth={3} />
          {pin.done ? t('panel.completed') : t('panel.markCompleted')}
        </button>
        <button
          type="button"
          aria-label={t('panel.deleteItem', { name: pin.name })}
          onClick={() => {
            removePin(placeId, mapId, pin.id)
            onClose()
          }}
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded border border-ink-600 text-ember hover:border-ember"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <form onSubmit={rename} className="mt-2 flex gap-1.5">
        <input
          aria-label={t('panel.renameItem', { name: pin.name })}
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          className="min-w-0 flex-1 rounded border border-ink-600 bg-ink-950 px-2 py-1 text-xs text-parchment-50 outline-none focus:border-parchment-400"
        />
        <button
          type="submit"
          disabled={!name.trim() || name.trim() === pin.name}
          className="cursor-pointer rounded bg-parchment-200 px-2 py-1 text-xs font-medium text-ink-950 hover:bg-parchment-50 disabled:opacity-40"
        >
          {t('common.rename')}
        </button>
      </form>
    </PinPopoverFrame>
  )
}

function resolvePlayerMapId(place: Place, rawMapId: string | null, age: 'child' | 'adult' | null): string | null {
  if (rawMapId && place.maps.some((m) => m.id === rawMapId)) {
    return rawMapId
  }
  if (place.maps.length === 1) {
    return place.maps[0]?.id ?? null
  }
  if (age === 'child' && place.maps.some((m) => m.id === 'nino')) {
    return 'nino'
  }
  if (age === 'adult' && place.maps.some((m) => m.id === 'adulto')) {
    return 'adulto'
  }
  return place.startMap ?? place.maps[0]?.id ?? null
}

function MappedPlace({
  place,
  firstMap,
  initialItemId,
  initialMapId,
}: {
  place: Place
  firstMap: PlaceMap
  initialItemId?: string
  initialMapId?: string
}) {
  const { t, tPlace, tItemName } = useI18n()
  const navigate = useNavigate()
  const hasFloorGrid = place.kind === 'dungeon' && place.maps.length > 1
  const [showAllFloors, setShowAllFloors] = useState(false)
  const allFloors = hasFloorGrid && showAllFloors
  const tracker = useLichiiTracker({ trackPosition: false })
  const isLiveMemory = isLiveMemoryState(tracker.state)
  const hasPlayerPin = isLiveMemory || tracker.state.source === 'save'
  const isPlayerInPlace =
    hasPlayerPin &&
    (tracker.state.placeId === place.id || tracker.state.placeSlug === place.slug)
  const playerMapId = isPlayerInPlace
    ? resolvePlayerMapId(place, tracker.state.mapId, tracker.state.age)
    : null

  const items = useMemo(() => itemsOfPlace(place.id), [place.id])
  const initialItem = useMemo(
    () => (initialItemId ? items.find((item) => item.id === initialItemId) ?? null : null),
    [initialItemId, items],
  )

  const [map, setMap] = useState<PlaceMap>(() => {
    const requestedMapId = initialMapId ?? initialItem?.at?.map
    if (requestedMapId) {
      const matched = place.maps.find((candidate) => candidate.id === requestedMapId)
      if (matched) return matched
    }
    if (playerMapId) {
      const matched = place.maps.find((candidate) => candidate.id === playerMapId)
      if (matched) return matched
    }
    return firstMap
  })
  const [selection, setSelection] = useState<Selection>(() =>
    initialItem ? { kind: 'item', id: initialItem.id } : null,
  )
  const [draft, setDraft] = useState<FloorDraft | null>(null)
  const [merge, setMerge] = useState<Merge | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  const handleSearchNavigate = useCallback(
    (target: QuickSearchTarget) => {
      if (target.kind === 'place') {
        void navigate({ to: '/$zone', params: { zone: target.slug } })
      } else {
        void navigate({
          to: '/$zone',
          params: { zone: target.placeSlug },
          search: { pin: target.itemId },
        })
      }
    },
    [navigate],
  )
  const mainRef = useRef<HTMLElement>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const viewport = useRef<MapViewportHandle>(null)
  const { isFullscreen, enterFullscreen, exitFullscreen } = useFullscreenMap(mainRef)
  const [isCompactViewport, setIsCompactViewport] = useState(false)
  const prevFullscreenRef = useRef(isFullscreen)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 1023px), (pointer: coarse)')
    const sync = () => setIsCompactViewport(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const wasFullscreen = prevFullscreenRef.current
    prevFullscreenRef.current = isFullscreen
    if (wasFullscreen && !isFullscreen && isCompactViewport) {
      viewport.current?.resetView()
    }
  }, [isFullscreen, isCompactViewport])

  const showPinPopover = isFullscreen

  useEffect(() => {
    if (!showPinPopover || !selection || typeof document === 'undefined') return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-pin], [data-pin-popover]')) return
      if (mapContainerRef.current?.contains(target) && !target.closest('button, a')) return
      setSelection(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showPinPopover, selection])

  const pins = useStored(pinsSlot(place.id, map.id))
  const showOfficial = useStored(officialVisibleSlot)
  const hideDone = useStored(hideDoneSlot)
  const spoilerFree = useStored(spoilerFreeSlot)
  const hidden = useStored(hiddenCategoriesSlot)
  const age = useStored(ageFilterSlot)
  const prereqFilterEnabled = useStored(prereqFilterEnabledSlot)
  const ownedPrereqs = useStored(ownedPrereqsSlot)
  const revealedIds = useStored(officialRevealedSlot)
  const revealed = useMemo(() => new Set(revealedIds), [revealedIds])
  const [mergeDisabledPrereq, setMergeDisabledPrereq] = useState(false)

  const ownedExpanded = useMemo(() => expandOwnedRequirements(ownedPrereqs), [ownedPrereqs])
  const detailOwnedExpanded =
    prereqFilterEnabled || ownedPrereqs.length > 0 ? ownedExpanded : undefined
  const beanEvalOptions = useMemo(
    () =>
      tracker.prereqAutoSync && tracker.state.authoritativeBeans && tracker.state.collectedBeanIds
        ? { beanAutoSynced: true, collectedBeanIds: new Set(tracker.state.collectedBeanIds) }
        : undefined,
    [tracker.prereqAutoSync, tracker.state.authoritativeBeans, tracker.state.collectedBeanIds],
  )

  const selectedCustom = selection?.kind === 'custom' ? selection.id : null
  const selectedItem = selection?.kind === 'item' ? selection.id : null
  const selectedOfficialItem = useMemo(
    () => (selectedItem ? items.find((item) => item.id === selectedItem) ?? null : null),
    [selectedItem, items],
  )

  const doneIds = useStored(officialDoneSlot)
  const { done, count } = useOfficialProgress(items)

  const lastAppliedPinRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialItem || lastAppliedPinRef.current === initialItem.id) return
    lastAppliedPinRef.current = initialItem.id
    if (initialItem.at?.map) {
      const targetFloor = place.maps.find((candidate) => candidate.id === initialItem.at?.map)
      if (targetFloor) {
        setMap(targetFloor)
        setShowAllFloors(false)
      }
    }
    setSelection({ kind: 'item', id: initialItem.id })
    if (!showOfficial && !revealed.has(initialItem.id)) {
      setInList(officialRevealedSlot, initialItem.id, true)
    }
    if (initialItem.at) {
      const targetAt = initialItem.at
      setTimeout(() => viewport.current?.centerOn(targetAt), 0)
    }
  }, [initialItem, place.maps, showOfficial, revealed])
  const grid = useMemo(() => layoutFloors(place.maps), [place.maps])
  const inView = useMemo(
    () => items.filter((item) => (allFloors ? item.at : item.at?.map === map.id)),
    [items, allFloors, map.id],
  )
  const onMap = useMemo(
    () =>
      inView.filter(
        (item) => matchesAge(item, age) && (!hideDone || !done.has(item.id) || item.id === selectedItem),
      ),
    [inView, age, hideDone, done, selectedItem],
  )
  const unplaced = useMemo(
    () =>
      items.filter(
        (item) =>
          matchesAge(item, age) &&
          isUnplaced(item, place) &&
          (!hideDone || !done.has(item.id) || item.id === selectedItem),
      ),
    [items, age, place, hideDone, done, selectedItem],
  )
  // With official pins off, only reveals count, and no filter can hide those.
  const isShown = useCallback(
    (item: Item) =>
      (showOfficial
        ? matchesAge(item, age) &&
          !hidden.includes(item.cat) &&
          (!prereqFilterEnabled || meetsItemRequirements(item, ownedExpanded, beanEvalOptions))
        : revealed.has(item.id)) &&
      (!hideDone || !done.has(item.id) || item.id === selectedItem),
    [
      showOfficial,
      age,
      hidden,
      prereqFilterEnabled,
      ownedExpanded,
      beanEvalOptions,
      revealed,
      hideDone,
      done,
      selectedItem,
    ],
  )
  const shownOnMap = useMemo(() => inView.filter(isShown), [inView, isShown])

  const targetPlace = useMemo(
    () =>
      dataset.places.find(
        (p) => p.id === tracker.state.placeId || p.slug === tracker.state.placeSlug,
      ) ?? null,
    [tracker.state.placeId, tracker.state.placeSlug],
  )
  const prevTargetSlugRef = useRef<string | null>(targetPlace?.slug ?? null)
  const prevPlayerMapIdRef = useRef<string | null>(playerMapId)
  const prevFollowRef = useRef<boolean>(tracker.followPlayer)
  const prevIsLiveMemoryRef = useRef<boolean>(isLiveMemory)

  // Follow Link across places and floors when followPlayer is enabled and RAM is live
  useEffect(() => {
    const targetSlug = targetPlace?.slug ?? null
    const slugChanged = targetSlug !== null && targetSlug !== prevTargetSlugRef.current
    const floorChanged = playerMapId !== null && playerMapId !== prevPlayerMapIdRef.current
    const followJustEnabled = tracker.followPlayer && !prevFollowRef.current
    const justBecameLive = isLiveMemory && !prevIsLiveMemoryRef.current

    prevTargetSlugRef.current = targetSlug
    prevPlayerMapIdRef.current = playerMapId
    prevFollowRef.current = tracker.followPlayer
    prevIsLiveMemoryRef.current = isLiveMemory

    if (!tracker.followPlayer || !isLiveMemory) return

    if (targetSlug && targetSlug !== place.slug && (slugChanged || followJustEnabled || justBecameLive)) {
      void navigate({ to: '/$zone', params: { zone: targetSlug } })
      return
    }
    if (
      isPlayerInPlace &&
      playerMapId &&
      playerMapId !== map.id &&
      !showAllFloors &&
      (floorChanged || followJustEnabled || justBecameLive)
    ) {
      const next = place.maps.find((candidate) => candidate.id === playerMapId)
      if (next) {
        setMap(next)
      }
    }
  }, [
    tracker.followPlayer,
    isLiveMemory,
    targetPlace,
    isPlayerInPlace,
    playerMapId,
    place.slug,
    place.maps,
    map.id,
    showAllFloors,
    navigate,
  ])

  useEffect(() => {
    if (!tracker.followPlayer || !isLiveMemory || !isPlayerInPlace) return
    const resolveTarget = (): Fraction | null => {
      const at = getLichiiPositionSnapshot().mapFraction
      if (!at) return null
      if (allFloors) {
        if (!playerMapId) return null
        const cell = grid.cells.find((c) => c.map.id === playerMapId)
        return cell ? floorToGrid(cell, at) : null
      }
      if (playerMapId && playerMapId !== map.id) return null
      return at
    }
    const syncCamera = (snap: boolean) => {
      const target = resolveTarget()
      if (!target) return
      if (snap) {
        viewport.current?.centerOn(target)
      } else {
        viewport.current?.panToFraction(target.x, target.y)
      }
    }
    syncCamera(true)
    return subscribeLichiiPosition(() => syncCamera(false))
  }, [tracker.followPlayer, isLiveMemory, isPlayerInPlace, allFloors, playerMapId, map.id, grid])

  function toggleSelection(next: NonNullable<Selection>, focus?: Fraction | null) {
    const closing = selection?.kind === next.kind && selection.id === next.id
    setSelection(closing ? null : next)
    setDraft(null)
    if (!closing && focus) viewport.current?.centerOn(focus)
  }

  const toggleSelectionRef = useRef(toggleSelection)
  toggleSelectionRef.current = toggleSelection
  const itemSelectCallbacksRef = useRef(new Map<string, () => void>())
  const getItemSelectCallback = useCallback((id: string) => {
    let cb = itemSelectCallbacksRef.current.get(id)
    if (!cb) {
      cb = () => toggleSelectionRef.current({ kind: 'item', id })
      itemSelectCallbacksRef.current.set(id, cb)
    }
    return cb
  }, [])

  function changeMap(id: string) {
    const next = place.maps.find((candidate) => candidate.id === id)
    if (!next) return
    setMap(next)
    setShowAllFloors(false)
    setSelection(null)
    setDraft(null)
    setMerge(null)
    setMergeDisabledPrereq(false)
  }

  function showGrid() {
    setShowAllFloors(true)
    setSelection(null)
    setDraft(null)
    setMerge(null)
    setMergeDisabledPrereq(false)
  }

  function mergeInto(item: Item, to: Fraction, type: string, name: string, from: FloorDraft) {
    const unhid = showOfficial && hidden.includes(item.cat)
    const previousAge = showOfficial && !matchesAge(item, age) ? age : null
    const disabledPrereq =
      showOfficial &&
      prereqFilterEnabled &&
      !meetsItemRequirements(item, ownedExpanded, beanEvalOptions)
    setMerge({
      id: Date.now(),
      item,
      mapId: from.mapId,
      type,
      name,
      from: from.at,
      to,
      appeared: !isShown(item),
      revealed: !revealed.has(item.id),
      unhid,
      previousAge,
    })
    setMergeDisabledPrereq(disabledPrereq)
    setInList(officialRevealedSlot, item.id, true)
    if (unhid) setInList(hiddenCategoriesSlot, item.cat, false)
    if (previousAge) write(ageFilterSlot, 'both')
    if (disabledPrereq) write(prereqFilterEnabledSlot, false)
    setDraft(null)
    setSelection(null)
  }

  function createPin(type: string, name = translatedPinTypeLabel(type, t)) {
    if (!draft) return
    const floor = place.maps.find((candidate) => candidate.id === draft.mapId)
    const match =
      floor && type !== OTHER_PIN
        ? findMerge(items, { type, mapId: floor.id, at: draft.at, aspect: floor.aspect }, revealed)
        : null
    if (match?.at) {
      mergeInto(match, match.at, type, name, draft)
      return
    }
    const pin = addPin(place.id, draft.mapId, name, draft.at, type)
    setDraft(null)
    setSelection({ kind: 'custom', id: pin.id, mapId: draft.mapId })
  }

  function undoMerge() {
    if (!merge) return
    if (merge.revealed) setInList(officialRevealedSlot, merge.item.id, false)
    if (merge.unhid) setInList(hiddenCategoriesSlot, merge.item.cat, true)
    if (merge.previousAge) write(ageFilterSlot, merge.previousAge)
    if (mergeDisabledPrereq) write(prereqFilterEnabledSlot, true)
    setMergeDisabledPrereq(false)
    const pin = addPin(place.id, merge.mapId, merge.name, merge.from, merge.type)
    setMerge(null)
    setSelection({ kind: 'custom', id: pin.id, mapId: merge.mapId })
  }

  /** Where to centre for a point on a floor, in the view on screen. */
  function focusPoint(mapId: string, at: Fraction): Fraction | null {
    return allFloors ? gridPoint(grid, mapId, at) : at
  }

  function selectOfficial(item: Item) {
    if (item.at && !allFloors && item.at.map !== map.id) {
      const targetFloor = place.maps.find((candidate) => candidate.id === item.at?.map)
      if (targetFloor) setMap(targetFloor)
    }
    toggleSelection({ kind: 'item', id: item.id }, item.at && focusPoint(item.at.map, item.at))
  }

  const centerOnPlayerPoint = useCallback((at: Fraction) => {
    viewport.current?.centerOn(at)
  }, [])

  const floorPlayer = useMemo(
    () =>
      isPlayerInPlace && playerMapId
        ? {
            mapId: playerMapId,
            live: isLiveMemory,
            onClick: centerOnPlayerPoint,
          }
        : null,
    [isPlayerInPlace, playerMapId, isLiveMemory, centerOnPlayerPoint],
  )

  function jumpToPlayer() {
    const targetPlace = dataset.places.find(
      (p) => p.id === tracker.state.placeId || p.slug === tracker.state.placeSlug,
    )
    if (targetPlace && targetPlace.slug !== place.slug) {
      void navigate({ to: '/$zone', params: { zone: targetPlace.slug } })
      return
    }
    if (!isPlayerInPlace) return
    if (playerMapId && (playerMapId !== map.id || allFloors)) {
      const next = place.maps.find((candidate) => candidate.id === playerMapId)
      if (next) setMap(next)
      if (allFloors) setShowAllFloors(false)
    }
    const targetAt = getLichiiPositionSnapshot().mapFraction
    if (targetAt) {
      viewport.current?.centerOn(targetAt)
      setTimeout(() => viewport.current?.centerOn(targetAt), 0)
    }
  }

  function renderPinPopover(projection: Projection) {
    if (!showPinPopover || !selection || draft) return null
    if (selection.kind === 'item') {
      const item = items.find((i) => i.id === selection.id)
      if (!item?.at) return null
      const anchor = focusPoint(item.at.map, item.at)
      if (!anchor) return null
      return (
        <ItemPinPopover
          placeSlug={place.slug}
          item={item}
          at={anchor}
          projection={projection}
          done={done.has(item.id)}
          revealed={revealed.has(item.id)}
          ownedExpanded={detailOwnedExpanded}
          evalOptions={beanEvalOptions}
          onClose={() => setSelection(null)}
        />
      )
    }
    const customMapId = selection.mapId
    return (
      <CustomPinPopover
        placeId={place.id}
        mapId={customMapId}
        pinId={selection.id}
        projection={projection}
        projectAnchor={(pin) => focusPoint(customMapId, pin)}
        onClose={() => setSelection(null)}
      />
    )
  }

  const isChildAdultPlace =
    place.maps.length > 1 && place.maps.every((candidate) => candidate.id === 'nino' || candidate.id === 'adulto')

  const fullscreenWorldMapButton = isFullscreen ? (
    <Link
      to="/"
      aria-label={t('map.worldMap')}
      title={t('map.worldMap')}
      className="grid size-9 place-items-center rounded-lg border border-ink-600 bg-ink-900/95 text-parchment-200 shadow-lg transition-colors hover:border-parchment-400 hover:bg-ink-700 hover:text-parchment-50"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5Z" />
        <path d="M9 4v13.5" />
        <path d="M15 6.5V20" />
        <path d="m12 9.2 1.8 3.1h-3.6L12 9.2Z" fill="currentColor" stroke="none" />
      </svg>
    </Link>
  ) : null

  return (
    <main
      ref={mainRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 flex h-dvh w-full flex-col bg-ink-950 max-lg:landscape:flex-row lg:flex-row'
          : 'flex h-dvh flex-col bg-ink-950 max-lg:landscape:flex-row lg:flex-row'
      }
    >
      <div ref={mapContainerRef} className="relative min-h-0 flex-[1.3] max-lg:landscape:flex-1 lg:flex-1">
        {allFloors ? (
          <FloorGrid
            place={place}
            grid={grid}
            viewport={viewport}
            draft={draft}
            controlsAboveZoom={fullscreenWorldMapButton}
            isFullscreen={isFullscreen}
            onDraft={(next) => {
              setDraft(next)
              if (next) setSelection(null)
            }}
            onDismiss={selection ? () => setSelection(null) : undefined}
            pinOverlay={renderPinPopover}
            onCreate={createPin}
            officialItems={shownOnMap}
            done={done}
            selectedCustom={selectedCustom}
            selectedItem={selectedItem}
            merge={merge}
            player={floorPlayer}
            onSelectCustom={(id, floorId) => toggleSelection({ kind: 'custom', id, mapId: floorId })}
            onSelectItem={(id) => toggleSelection({ kind: 'item', id })}
          />
        ) : (
          <MapViewport
            ref={viewport}
            viewId={`${place.id}:${map.id}`}
            image={map.image}
            alt={t('place.mapAlt', {
              place: tPlace(place.id, place.name),
              floor: translateFloorLabel(map.label, t),
            })}
            aspect={map.aspect}
            controlsAboveZoom={fullscreenWorldMapButton}
            isFullscreen={isFullscreen}
            onMapClick={(at) => {
              setDraft({ mapId: map.id, at })
              setSelection(null)
            }}
            onDismiss={
              draft || selection
                ? () => {
                    setDraft(null)
                    setSelection(null)
                  }
                : undefined
            }
            overlay={(projection) => (
              <>
                {draft && (
                  <NewPinPopover
                    key={`${draft.at.x},${draft.at.y}`}
                    at={draft.at}
                    projection={projection}
                    onCancel={() => setDraft(null)}
                    onCreate={createPin}
                  />
                )}
                {renderPinPopover(projection)}
              </>
            )}
          >
            {shownOnMap.map(
              (item) =>
                item.at && (
                  <OfficialMarker
                    key={item.id}
                    item={item}
                    at={item.at}
                    done={done.has(item.id)}
                    selected={item.id === selectedItem}
                    merge={merge}
                    onSelect={getItemSelectCallback(item.id)}
                  />
                ),
            )}
            {pins.map((pin) => (
              <CustomMarker
                key={pin.id}
                pin={pin}
                selected={pin.id === selectedCustom}
                onSelect={() => toggleSelection({ kind: 'custom', id: pin.id, mapId: map.id })}
              />
            ))}
            {isPlayerInPlace && playerMapId === map.id && (
              <LivePlayerPin
                mode="place"
                live={isLiveMemory}
                label={t('common.link')}
                sublabel={translateFloorLabel(map.label, t)}
                onClick={centerOnPlayerPoint}
              />
            )}
            {draft && <DraftMarker at={draft.at} />}
            {merge && <MergeTrail key={merge.id} merge={merge} />}
          </MapViewport>
        )}
        {place.maps.length > 1 && !(isFullscreen && isChildAdultPlace) && (
          <MapSwitcher
            maps={place.maps}
            current={allFloors ? null : map.id}
            playerMapId={playerMapId}
            playerLive={isLiveMemory}
            onChange={changeMap}
            allFloors={hasFloorGrid ? { active: allFloors, onShow: showGrid } : undefined}
            isFullscreen={isFullscreen}
          />
        )}
        {merge && (
          <MergeNotice
            key={merge.id}
            merge={merge}
            done={done.has(merge.item.id)}
            onComplete={() => setInList(officialDoneSlot, merge.item.id, true)}
            onUndo={undoMerge}
            onDismiss={() => {
              setMerge(null)
              setMergeDisabledPrereq(false)
            }}
          />
        )}
        {isFullscreen ? (
          <div
            style={{
              top: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
              right: 'calc(0.75rem + env(safe-area-inset-right, 0px))',
            }}
            className="pointer-events-none absolute top-3 right-3 z-40 flex flex-col items-end gap-2"
          >
            <button
              type="button"
              onClick={() => void exitFullscreen()}
              aria-label={t('map.exitFullscreenAria')}
              title={t('map.exitFullscreenAria')}
              className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-900/95 px-3 py-1.5 text-xs font-medium text-parchment-50 shadow-lg transition-colors hover:border-parchment-400 hover:bg-ink-800"
            >
              <Minimize2 size={14} />
              {t('map.exitFullscreen')}
            </button>
            {isChildAdultPlace && (
              <MapSwitcher
                maps={place.maps}
                current={allFloors ? null : map.id}
                playerMapId={playerMapId}
                playerLive={isLiveMemory}
                onChange={changeMap}
                inline
                isFullscreen
              />
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void enterFullscreen()}
            aria-label={t('map.enterFullscreen')}
            title={t('map.fullscreenMap')}
            className="absolute top-3 right-3 z-30 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-900/95 px-2.5 py-1.5 text-xs font-medium text-parchment-50 shadow-lg transition-colors hover:border-parchment-400 hover:bg-ink-800 lg:hidden"
          >
            <Maximize2 size={14} />
            <span className="max-sm:hidden">{t('map.fullscreen')}</span>
          </button>
        )}
        <LichiiStatusPanel
          state={tracker.state}
          followPlayer={tracker.followPlayer}
          onToggleFollow={tracker.toggleFollowPlayer}
          autoMarkSkulltulas={tracker.autoMarkSkulltulas}
          onToggleAutoMark={tracker.toggleAutoMarkSkulltulas}
          toasts={tracker.toasts}
          onDismissToast={tracker.dismissToast}
          onJumpToPlayer={jumpToPlayer}
          onSelectItem={(itemId) => {
            const target = items.find((i) => i.id === itemId)
            if (target) selectOfficial(target)
          }}
          error={tracker.error}
          onRetry={tracker.refresh}
          isFullscreen={isFullscreen}
          fullscreenToastTop={isChildAdultPlace ? '6rem' : undefined}
        />
      </div>

      {!isFullscreen && (
        <Sidebar
          place={place}
          progress={count}
          total={items.length}
          onEnterFullscreen={() => void enterFullscreen()}
          onOpenSearch={openSearch}
        >
          {allFloors ? (
            <>
              <Section title={t('place.yourPins')}>
                <p className="text-sm text-parchment-400">{t('place.clickFloorToAdd')}</p>
              </Section>
              {place.maps.map((floor) => (
                <FloorPinList
                  key={floor.id}
                  place={place}
                  map={floor}
                  selectedId={selectedCustom}
                  onSelect={(pin) => toggleSelection({ kind: 'custom', id: pin.id, mapId: floor.id }, focusPoint(floor.id, pin))}
                />
              ))}
            </>
          ) : (
            <CustomPinList
              pins={pins}
              placeId={place.id}
              mapId={map.id}
              selectedId={selectedCustom}
              onSelect={(pin) => toggleSelection({ kind: 'custom', id: pin.id, mapId: map.id }, pin)}
            />
          )}
          <Section title={t('place.officialPins')} aside={<OfficialToggle on={showOfficial} />}>
            <HideDoneToggle on={hideDone} />
            <SpoilerFreeToggle on={spoilerFree} />
            {selectedOfficialItem && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-ink-700 bg-ink-950/60 px-2.5 py-1.5">
                <span className="truncate text-xs text-parchment-200">
                  {tItemName(selectedOfficialItem.id, selectedOfficialItem.name)}
                </span>
                <CopyPinLinkButton placeSlug={place.slug} itemId={selectedOfficialItem.id} />
              </div>
            )}
            {showOfficial ? (
              <OfficialList
                onMap={onMap}
                unplaced={unplaced}
                age={age}
                hidden={hidden}
                done={done}
                selectedId={selectedItem}
                onSelect={selectOfficial}
                evalOptions={beanEvalOptions}
              />
            ) : (
              <RevealedList
                items={shownOnMap}
                done={done}
                selectedId={selectedItem}
                onSelect={selectOfficial}
                ownedExpanded={detailOwnedExpanded}
                evalOptions={beanEvalOptions}
              />
            )}
          </Section>
        </Sidebar>
      )}
      <QuickSearchModal
        open={searchOpen}
        onOpen={openSearch}
        onClose={closeSearch}
        onNavigate={handleSearchNavigate}
        doneIds={doneIds}
      />
    </main>
  )
}

function MaplessPlace({ place, initialItemId }: { place: Place; initialItemId?: string }) {
  const { t, tItemName } = useI18n()
  const navigate = useNavigate()
  const tracker = useLichiiTracker({ trackPosition: false })
  const isLiveMemory = isLiveMemoryState(tracker.state)
  const items = useMemo(() => itemsOfPlace(place.id), [place.id])
  const [selected, setSelected] = useState<string | null>(() =>
    initialItemId && items.some((item) => item.id === initialItemId) ? initialItemId : null,
  )
  const [searchOpen, setSearchOpen] = useState(false)
  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  const handleSearchNavigate = useCallback(
    (target: QuickSearchTarget) => {
      if (target.kind === 'place') {
        void navigate({ to: '/$zone', params: { zone: target.slug } })
      } else {
        void navigate({
          to: '/$zone',
          params: { zone: target.placeSlug },
          search: { pin: target.itemId },
        })
      }
    },
    [navigate],
  )
  const hidden = useStored(hiddenCategoriesSlot)
  const age = useStored(ageFilterSlot)
  const showOfficial = useStored(officialVisibleSlot)
  const hideDone = useStored(hideDoneSlot)
  const spoilerFree = useStored(spoilerFreeSlot)
  const prereqFilterEnabled = useStored(prereqFilterEnabledSlot)
  const ownedPrereqs = useStored(ownedPrereqsSlot)
  const revealedIds = useStored(officialRevealedSlot)
  const revealed = useMemo(() => new Set(revealedIds), [revealedIds])
  const ownedExpanded = useMemo(() => expandOwnedRequirements(ownedPrereqs), [ownedPrereqs])
  const detailOwnedExpanded =
    prereqFilterEnabled || ownedPrereqs.length > 0 ? ownedExpanded : undefined
  const doneIds = useStored(officialDoneSlot)
  const { done, count } = useOfficialProgress(items)
  const selectedOfficialItem = useMemo(
    () => (selected ? items.find((item) => item.id === selected) ?? null : null),
    [selected, items],
  )

  const lastAppliedPinRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialItemId || lastAppliedPinRef.current === initialItemId) return
    const matched = items.find((item) => item.id === initialItemId)
    if (!matched) return
    lastAppliedPinRef.current = matched.id
    setSelected(matched.id)
    if (!showOfficial && !revealed.has(matched.id)) {
      setInList(officialRevealedSlot, matched.id, true)
    }
  }, [initialItemId, items, showOfficial, revealed])
  const revealedItems = useMemo(
    () =>
      items.filter(
        (item) => revealed.has(item.id) && (!hideDone || !done.has(item.id) || item.id === selected),
      ),
    [items, revealed, hideDone, done, selected],
  )
  const beanEvalOptions = useMemo(
    () =>
      tracker.prereqAutoSync && tracker.state.authoritativeBeans && tracker.state.collectedBeanIds
        ? { beanAutoSynced: true, collectedBeanIds: new Set(tracker.state.collectedBeanIds) }
        : undefined,
    [tracker.prereqAutoSync, tracker.state.authoritativeBeans, tracker.state.collectedBeanIds],
  )

  const targetPlace = useMemo(
    () =>
      dataset.places.find(
        (p) => p.id === tracker.state.placeId || p.slug === tracker.state.placeSlug,
      ) ?? null,
    [tracker.state.placeId, tracker.state.placeSlug],
  )
  const prevTargetSlugRef = useRef<string | null>(targetPlace?.slug ?? null)
  const prevFollowRef = useRef<boolean>(tracker.followPlayer)
  const prevIsLiveMemoryRef = useRef<boolean>(isLiveMemory)

  useEffect(() => {
    const targetSlug = targetPlace?.slug ?? null
    const slugChanged = targetSlug !== null && targetSlug !== prevTargetSlugRef.current
    const followJustEnabled = tracker.followPlayer && !prevFollowRef.current
    const justBecameLive = isLiveMemory && !prevIsLiveMemoryRef.current

    prevTargetSlugRef.current = targetSlug
    prevFollowRef.current = tracker.followPlayer
    prevIsLiveMemoryRef.current = isLiveMemory

    if (!tracker.followPlayer || !isLiveMemory) return
    if (targetSlug && targetSlug !== place.slug && (slugChanged || followJustEnabled || justBecameLive)) {
      void navigate({ to: '/$zone', params: { zone: targetSlug } })
    }
  }, [tracker.followPlayer, isLiveMemory, targetPlace, place.slug, navigate])

  return (
    <main className="flex h-dvh flex-col bg-ink-950 max-lg:landscape:flex-row lg:flex-row">
      <div className="relative grid flex-none place-items-center p-8 text-center max-lg:landscape:flex-1 lg:flex-1">
        <div className="max-w-sm rounded-lg border border-parchment-600/50 bg-ink-900 px-6 py-5">
          <h2 className="font-serif text-lg text-parchment-50">{t('place.noMapTitle')}</h2>
          <p className="mt-1 text-sm text-parchment-400">
            {items.length > 0 ? t('place.noMapWithItems') : t('place.noMapEmpty')}
          </p>
        </div>
        <LichiiStatusPanel
          state={tracker.state}
          followPlayer={tracker.followPlayer}
          onToggleFollow={tracker.toggleFollowPlayer}
          autoMarkSkulltulas={tracker.autoMarkSkulltulas}
          onToggleAutoMark={tracker.toggleAutoMarkSkulltulas}
          toasts={tracker.toasts}
          onDismissToast={tracker.dismissToast}
          onJumpToPlayer={() => {
            if (targetPlace && targetPlace.slug !== place.slug) {
              void navigate({ to: '/$zone', params: { zone: targetPlace.slug } })
            }
          }}
          onSelectItem={(itemId) => setSelected(itemId)}
          error={tracker.error}
          onRetry={tracker.refresh}
        />
      </div>
      <Sidebar place={place} progress={count} total={items.length} onOpenSearch={openSearch}>
        {items.length > 0 && (
          <Section title={t('place.officialPins')} aside={<OfficialToggle on={showOfficial} />}>
            <HideDoneToggle on={hideDone} />
            <SpoilerFreeToggle on={spoilerFree} />
            {selectedOfficialItem && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-ink-700 bg-ink-950/60 px-2.5 py-1.5">
                <span className="truncate text-xs text-parchment-200">
                  {tItemName(selectedOfficialItem.id, selectedOfficialItem.name)}
                </span>
                <CopyPinLinkButton placeSlug={place.slug} itemId={selectedOfficialItem.id} />
              </div>
            )}
            {showOfficial ? (
              <OfficialList
                onMap={[]}
                unplaced={items.filter(
                  (item) => matchesAge(item, age) && (!hideDone || !done.has(item.id) || item.id === selected),
                )}
                age={age}
                hidden={hidden}
                done={done}
                selectedId={selected}
                onSelect={(item) => setSelected((id) => (id === item.id ? null : item.id))}
                evalOptions={beanEvalOptions}
              />
            ) : revealedItems.length > 0 ? (
              <RevealedList
                items={revealedItems}
                done={done}
                selectedId={selected}
                onSelect={(item) => setSelected((id) => (id === item.id ? null : item.id))}
                ownedExpanded={detailOwnedExpanded}
                evalOptions={beanEvalOptions}
              />
            ) : (
              <div className="rounded-md border border-ink-700 bg-ink-950/60 p-3 text-xs text-parchment-400">
                <p>{t('place.maplessOfficialHiddenHint')}</p>
                <button
                  type="button"
                  onClick={() => write(officialVisibleSlot, true)}
                  className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded bg-parchment-200 px-2.5 py-1 text-xs font-medium text-ink-950 transition-colors hover:bg-parchment-50"
                >
                  {t('panel.showOfficialPins')}
                </button>
              </div>
            )}
          </Section>
        )}
      </Sidebar>
      <QuickSearchModal
        open={searchOpen}
        onOpen={openSearch}
        onClose={closeSearch}
        onNavigate={handleSearchNavigate}
        doneIds={doneIds}
      />
    </main>
  )
}

export function PlaceView({
  place,
  initialItemId,
  initialMapId,
}: {
  place: Place
  initialItemId?: string
  initialMapId?: string
}) {
  const firstMap = startMapOf(place)
  return firstMap ? (
    <MappedPlace
      place={place}
      firstMap={firstMap}
      initialItemId={initialItemId}
      initialMapId={initialMapId}
    />
  ) : (
    <MaplessPlace place={place} initialItemId={initialItemId} />
  )
}
