import { Link, useNavigate } from '@tanstack/react-router'
import { BarChart3, Check, Compass, Info, Maximize2, Minimize2, Search, X } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { pinPosition } from '../lib/coords'
import { dataset, formatFloorLabel } from '../lib/data'
import { useI18n } from '../lib/i18n'
import { computeGlobalProgress } from '../lib/progress-stats'
import { itemCountVisibleSlot, officialDoneSlot, useStored } from '../lib/storage'
import type { Place } from '../lib/types'
import { useFullscreenMap } from '../lib/useFullscreenMap'
import {
  getLichiiPositionSnapshot,
  isLiveMemoryState,
  subscribeLichiiPosition,
  useLichiiTracker,
} from '../lib/useLichiiTracker'
import { CreditsModal } from './CreditsModal'
import { GlobalStatsDrawer } from './GlobalStatsDrawer'
import { LanguageSelector } from './LanguageSelector'
import { LichiiStatusPanel } from './LichiiStatusPanel'
import { MapViewport, type MapViewportHandle } from './MapViewport'
import { LivePlayerPin } from './PlayerPin'
import { QuickSearchModal, type QuickSearchTarget } from './QuickSearchModal'

const totals = new Map<string, number>()
for (const item of dataset.items) totals.set(item.place, (totals.get(item.place) ?? 0) + 1)

const PlaceLink = memo(function PlaceLink({
  place,
  done,
  showCount,
  isPlayerHere,
  isPlayerLive,
  selected,
  preferPopover,
  onSelect,
}: {
  place: Place
  done: number
  showCount: boolean
  isPlayerHere?: boolean
  isPlayerLive?: boolean
  selected?: boolean
  preferPopover?: boolean
  onSelect: (placeId: string) => void
}) {
  const { t, tPlace } = useI18n()
  const total = totals.get(place.id) ?? 0
  const complete = total > 0 && done === total
  const dungeon = place.kind === 'dungeon'
  const placeName = tPlace(place.id, place.name)
  const progress =
    total === 0
      ? t('world.noTrackedItems')
      : showCount
        ? t('world.itemsCompletedOf', { done, total })
        : null
  const touchPressRef = useRef(false)

  return (
    <div
      data-pin
      className={`absolute size-0 hover:z-10 focus-within:z-10 ${selected ? 'z-20' : ''}`}
      style={pinPosition(place.pin)}
    >
      <Link
        to="/$zone"
        params={{ zone: place.slug }}
        draggable={false}
        onPointerDown={(event) => {
          touchPressRef.current = event.pointerType === 'touch'
        }}
        onClick={(event) => {
          if (preferPopover || touchPressRef.current) {
            event.preventDefault()
            onSelect(place.id)
          }
        }}
        aria-label={[placeName, dungeon ? t('world.dungeon') : t('world.zone'), progress]
          .filter(Boolean)
          .join(', ')}
        aria-expanded={selected || undefined}
        className="group absolute -top-6 left-0 flex w-max -translate-x-1/2 cursor-pointer flex-col items-center rounded-lg"
      >
        <span className="grid size-12 place-items-center">
          <span
            className={`grid place-items-center border-2 shadow-md shadow-black/60 transition-transform group-hover:scale-125 group-focus-visible:scale-125 ${
              selected ? 'scale-125' : ''
            } ${
              dungeon
                ? 'size-4 rotate-45 border-ink-950 bg-ember'
                : 'size-4.5 rounded-full border-ink-950 bg-parchment-200'
            } ${complete ? 'bg-moss!' : ''} ${
              isPlayerHere
                ? isPlayerLive
                  ? 'ring-2 ring-moss ring-offset-2 ring-offset-ink-950'
                  : 'ring-2 ring-ember/70 ring-offset-2 ring-offset-ink-950'
                : ''
            }`}
          >
            {complete && <Check size={10} strokeWidth={4} className={`text-ink-950 ${dungeon ? '-rotate-45' : ''}`} />}
          </span>
        </span>
        <span
          className={`-mt-2.5 flex items-center gap-1 rounded border bg-ink-950/85 px-1.5 py-0.5 text-[11px] leading-tight font-medium text-parchment-50 transition-colors group-hover:bg-parchment-200 group-hover:text-ink-950 group-focus-visible:bg-parchment-200 group-focus-visible:text-ink-950 ${
            selected
              ? 'border-parchment-200 bg-parchment-200 text-ink-950'
              : isPlayerHere
                ? isPlayerLive
                  ? 'border-moss text-moss'
                  : 'border-ember/70 text-parchment-50'
                : dungeon
                  ? 'border-ember/70'
                  : 'border-parchment-600/50'
          }`}
        >
          {placeName}
          {showCount && total > 0 && done > 0 && <span className="tabular-nums opacity-70">{done}/{total}</span>}
        </span>
      </Link>
    </div>
  )
})

export function WorldMap() {
  const { t, tPlace, tRegion } = useI18n()
  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const viewport = useRef<MapViewportHandle>(null)
  const doneIds = useStored(officialDoneSlot)
  const countsShown = useStored(itemCountVisibleSlot)
  const tracker = useLichiiTracker({ trackPosition: false })
  const [statsOpen, setStatsOpen] = useState(false)
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)
  const [isCoarsePointer, setIsCoarsePointer] = useState(false)
  const [isCompactViewport, setIsCompactViewport] = useState(false)
  const { isFullscreen, enterFullscreen, exitFullscreen } = useFullscreenMap(mainRef)
  const prevFullscreenRef = useRef(isFullscreen)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const coarseQuery = window.matchMedia('(pointer: coarse)')
    const compactQuery = window.matchMedia('(max-width: 1023px), (pointer: coarse)')
    const sync = () => {
      setIsCoarsePointer(coarseQuery.matches)
      setIsCompactViewport(compactQuery.matches)
    }
    sync()
    coarseQuery.addEventListener('change', sync)
    compactQuery.addEventListener('change', sync)
    return () => {
      coarseQuery.removeEventListener('change', sync)
      compactQuery.removeEventListener('change', sync)
    }
  }, [])

  useEffect(() => {
    const wasFullscreen = prevFullscreenRef.current
    prevFullscreenRef.current = isFullscreen
    if (wasFullscreen && !isFullscreen && isCompactViewport) {
      viewport.current?.resetView()
    }
  }, [isFullscreen, isCompactViewport])

  useEffect(() => {
    if (!isFullscreen) setSelectedPlaceId(null)
  }, [isFullscreen])

  useEffect(() => {
    if (!selectedPlaceId || typeof document === 'undefined') return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-pin], [data-pin-popover]')) return
      setSelectedPlaceId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [selectedPlaceId])

  const summary = useMemo(() => computeGlobalProgress(doneIds, dataset), [doneIds])
  const donePerPlace = useMemo(
    () => new Map(summary.places.map((place) => [place.id, place.done])),
    [summary.places],
  )
  const selectedPlace = useMemo(
    () => (selectedPlaceId ? dataset.places.find((p) => p.id === selectedPlaceId) ?? null : null),
    [selectedPlaceId],
  )

  const activePlace = useMemo(
    () =>
      dataset.places.find(
        (p) => p.id === tracker.state.placeId || p.slug === tracker.state.placeSlug,
      ) ?? null,
    [tracker.state.placeId, tracker.state.placeSlug],
  )

  const isLiveMemory = isLiveMemoryState(tracker.state)
  const hasPlayerPin = isLiveMemory || tracker.state.source === 'save'
  const prevSlugRef = useRef<string | null | undefined>(undefined)
  const prevFollowRef = useRef<boolean>(tracker.followPlayer)
  const prevIsLiveMemoryRef = useRef<boolean>(isLiveMemory)

  useEffect(() => {
    const slug = activePlace?.slug ?? tracker.state.placeSlug
    const followJustEnabled = tracker.followPlayer && !prevFollowRef.current
    const justBecameLive = isLiveMemory && !prevIsLiveMemoryRef.current

    prevFollowRef.current = tracker.followPlayer
    prevIsLiveMemoryRef.current = isLiveMemory

    if (prevSlugRef.current === undefined) {
      prevSlugRef.current = slug
      return
    }

    const slugChanged = Boolean(slug && slug !== prevSlugRef.current)
    prevSlugRef.current = slug

    if (!tracker.followPlayer || !isLiveMemory) return

    if (slug && (slugChanged || followJustEnabled || justBecameLive)) {
      void navigate({ to: '/$zone', params: { zone: slug } })
    }
  }, [activePlace?.slug, tracker.state.placeSlug, tracker.followPlayer, isLiveMemory, navigate])

  useEffect(() => {
    if (!tracker.followPlayer || !isLiveMemory) return
    const syncCamera = (snap: boolean) => {
      const target = getLichiiPositionSnapshot().worldMapFraction ?? activePlace?.pin ?? null
      if (!target) return
      if (snap) {
        viewport.current?.centerOn(target)
      } else {
        viewport.current?.panToFraction(target.x, target.y)
      }
    }
    syncCamera(true)
    return subscribeLichiiPosition(() => syncCamera(false))
  }, [tracker.followPlayer, isLiveMemory, activePlace?.pin])

  const jumpToPlayer = useCallback(() => {
    const slug = activePlace?.slug ?? tracker.state.placeSlug
    if (slug) {
      void navigate({ to: '/$zone', params: { zone: slug } })
    } else {
      const worldAt = getLichiiPositionSnapshot().worldMapFraction ?? activePlace?.pin ?? null
      if (worldAt) viewport.current?.centerOn(worldAt)
    }
  }, [activePlace?.slug, activePlace?.pin, tracker.state.placeSlug, navigate])

  const handleSelectPlace = useCallback((placeId: string) => {
    setSelectedPlaceId((prev) => (prev === placeId ? null : placeId))
  }, [])

  const closeStats = useCallback(() => setStatsOpen(false), [])
  const closeCredits = useCallback(() => setCreditsOpen(false), [])
  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => setSearchOpen(false), [])
  const dismissSelectedPlace = useCallback(() => setSelectedPlaceId(null), [])
  const handleSelectItem = useCallback(
    (itemId: string) => {
      const item = dataset.items.find((candidate) => candidate.id === itemId)
      if (!item) return
      const place = dataset.places.find((candidate) => candidate.id === item.place)
      if (!place) return
      void navigate({
        to: '/$zone',
        params: { zone: place.slug },
        search: { pin: item.id },
      })
    },
    [navigate],
  )
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

  const playerSublabel = useMemo(
    () =>
      [
        activePlace
          ? tPlace(activePlace.id, activePlace.name)
          : (tracker.state.placeName ?? tracker.state.scene),
        tracker.state.mapId && tracker.state.mapId !== 'principal'
          ? tracker.state.mapId === 'nino'
            ? t('floor.child')
            : tracker.state.mapId === 'adulto'
              ? t('floor.adult')
              : formatFloorLabel(tracker.state.mapId)
          : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    [activePlace, tracker.state.placeName, tracker.state.scene, tracker.state.mapId, t, tPlace],
  )

  const preferPinPopover = isFullscreen || isCoarsePointer

  return (
    <main
      ref={mainRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 h-dvh w-full overflow-clip bg-ink-950'
          : 'relative h-dvh overflow-clip bg-ink-950'
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(76,66,51,0.3)_0%,rgba(19,16,12,0.95)_75%)]"
      />
      <MapViewport
        ref={viewport}
        viewId="world"
        image={dataset.map.image}
        alt={t('world.mapAlt')}
        aspect={dataset.map.width / dataset.map.height}
        isFullscreen={isFullscreen}
        onDismiss={selectedPlaceId ? dismissSelectedPlace : undefined}
        overlay={({ size, project }) => {
          if (!selectedPlace) return null
          const pt = project(selectedPlace.pin)
          const total = totals.get(selectedPlace.id) ?? 0
          const done = donePerPlace.get(selectedPlace.id) ?? 0
          const isPlayerHere = hasPlayerPin && activePlace?.id === selectedPlace.id
          const selectedPlaceName = tPlace(selectedPlace.id, selectedPlace.name)
          const popoverWidth = 240
          const left = Math.min(Math.max(12, pt.x - popoverWidth / 2), Math.max(12, size.width - popoverWidth - 12))
          const placeAbove = pt.y > size.height * 0.55
          const style = placeAbove
            ? { left, bottom: Math.max(12, size.height - pt.y + 18) }
            : { left, top: Math.min(Math.max(12, pt.y + 18), Math.max(12, size.height - 156)) }

          return (
            <div
              data-pin-popover
              role="dialog"
              aria-label={t('world.placeDetails', { name: selectedPlaceName })}
              style={style}
              className="pointer-events-auto absolute z-50 w-60 rounded-lg border border-ink-600 bg-ink-900/95 p-3 text-parchment-50 shadow-xl"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-serif text-base leading-tight text-parchment-50">
                    {selectedPlaceName}
                  </h2>
                  <p className="mt-0.5 text-xs text-parchment-400">
                    {selectedPlace.kind === 'dungeon' ? t('world.dungeon') : t('world.zone')} ·{' '}
                    {tRegion(selectedPlace.region)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPlaceId(null)}
                  aria-label={t('world.closePlaceInfo')}
                  className="-mt-0.5 -mr-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-50"
                >
                  <X size={14} />
                </button>
              </div>
              {isPlayerHere && (
                <div
                  className={`mt-2 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                    isLiveMemory
                      ? 'border-moss/40 bg-moss/15 text-moss'
                      : 'border-ember/40 bg-ember/15 text-ember'
                  }`}
                >
                  <Compass size={11} />
                  {isLiveMemory ? t('world.linkHereLive') : t('world.linkHereSaved')}
                </div>
              )}
              <p className="mt-2 text-xs text-parchment-200 tabular-nums">
                {total > 0 ? t('world.itemsCompleted', { done, total }) : t('world.noTrackedItems')}
              </p>
              <div className="mt-2.5 flex items-center justify-end gap-2">
                <Link
                  to="/$zone"
                  params={{ zone: selectedPlace.slug }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#e8c04a]/50 bg-[#e8c04a]/15 px-2.5 py-1 text-xs font-medium text-[#f3d473] transition-colors hover:bg-[#e8c04a]/25"
                >
                  {t('world.openMap')}
                </Link>
              </div>
            </div>
          )
        }}
      >
        {dataset.places.map((place) => (
          <PlaceLink
            key={place.id}
            place={place}
            done={donePerPlace.get(place.id) ?? 0}
            showCount={countsShown.includes(place.id)}
            isPlayerHere={hasPlayerPin && activePlace?.id === place.id}
            isPlayerLive={isLiveMemory}
            selected={selectedPlaceId === place.id}
            preferPopover={preferPinPopover}
            onSelect={handleSelectPlace}
          />
        ))}
        {hasPlayerPin && (
          <LivePlayerPin
            mode="world"
            fallbackAt={activePlace?.pin ?? null}
            live={isLiveMemory}
            label={t('common.link')}
            sublabel={playerSublabel}
            onClick={jumpToPlayer}
          />
        )}
      </MapViewport>
      {isFullscreen ? (
        <button
          type="button"
          onClick={() => void exitFullscreen()}
          aria-label={t('map.exitFullscreenAria')}
          title={t('map.exitFullscreenAria')}
          style={{
            top: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
            right: 'calc(0.75rem + env(safe-area-inset-right, 0px))',
          }}
          className="absolute top-3 right-3 z-40 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-900/95 px-3 py-1.5 text-xs font-medium text-parchment-50 shadow-lg transition-colors hover:border-parchment-400 hover:bg-ink-800"
        >
          <Minimize2 size={14} />
          {t('map.exitFullscreen')}
        </button>
      ) : (
        <>
          <header className="pointer-events-none absolute top-3 left-3 max-h-[calc(100dvh-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-ink-600 bg-ink-900/90 px-4 py-3 shadow-lg max-lg:landscape:px-3 max-lg:landscape:py-2">
            <div className="flex items-center justify-between gap-3">
              <h1 className="font-serif text-xl text-parchment-50 max-lg:landscape:text-lg">{t('app.title')}</h1>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={openSearch}
                  aria-label={t('search.open') || 'Search'}
                  title={t('search.open') || 'Search'}
                  className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800/90 px-2.5 py-1 text-xs font-medium text-parchment-50 transition-colors hover:border-parchment-400 hover:bg-ink-700"
                >
                  <Search size={13} className="text-[#e8c04a]" aria-hidden />
                  <kbd className="rounded border border-ink-600 bg-ink-950/80 px-1 py-px font-sans text-[10px] text-parchment-400 max-sm:hidden">
                    Ctrl+K
                  </kbd>
                </button>
                <LanguageSelector />
                <button
                  type="button"
                  onClick={() => setStatsOpen(true)}
                  aria-label={t('world.openStats')}
                  className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800/90 px-2.5 py-1 text-xs font-medium text-parchment-50 transition-colors hover:border-parchment-400 hover:bg-ink-700"
                >
                  <BarChart3 size={13} className="text-[#e8c04a]" />
                  {t('world.stats')}
                </button>
                <button
                  type="button"
                  onClick={() => setCreditsOpen(true)}
                  aria-label={t('credits.title')}
                  title={t('credits.button')}
                  className="pointer-events-auto inline-flex cursor-pointer items-center gap-1 rounded-md border border-ink-600 bg-ink-800/90 px-2 py-1 text-xs font-medium text-parchment-50 transition-colors hover:border-parchment-400 hover:bg-ink-700"
                >
                  <Info size={13} className="text-[#e8c04a]" aria-hidden />
                  <span className="max-sm:hidden">{t('credits.button')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void enterFullscreen()}
                  aria-label={t('map.enterFullscreen')}
                  title={t('map.fullscreenMap')}
                  className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800/90 px-2.5 py-1 text-xs font-medium text-parchment-50 transition-colors hover:border-parchment-400 hover:bg-ink-700"
                >
                  <Maximize2 size={13} />
                  <span className="max-sm:hidden">{t('map.fullscreen')}</span>
                </button>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-2.5 max-lg:landscape:mt-1">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800"
                role="progressbar"
                aria-valuenow={summary.percentage}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('world.globalCompletion')}
              >
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    summary.totalItems > 0 && summary.totalDone === summary.totalItems
                      ? 'bg-moss'
                      : 'bg-[#e8c04a]'
                  }`}
                  style={{ width: `${summary.percentage}%` }}
                />
              </div>
              <p className="shrink-0 text-xs text-parchment-400 tabular-nums">
                {summary.totalDone} / {summary.totalItems} ({summary.percentage}%)
              </p>
            </div>
            <ul className="mt-2 flex gap-4 text-xs text-parchment-200 max-lg:landscape:mt-1.5">
              <li className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-parchment-200" /> {t('world.zone')}
              </li>
              <li className="flex items-center gap-1.5">
                <span className="size-2.5 rotate-45 bg-ember" /> {t('world.dungeon')}
              </li>
              <li className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-moss" /> {t('common.link')}
              </li>
            </ul>
          </header>
          <GlobalStatsDrawer open={statsOpen} onClose={closeStats} summary={summary} doneIds={doneIds} />
          <CreditsModal open={creditsOpen} onClose={closeCredits} />
        </>
      )}
      <QuickSearchModal
        open={searchOpen}
        onOpen={openSearch}
        onClose={closeSearch}
        onNavigate={handleSearchNavigate}
        doneIds={doneIds}
      />
      <LichiiStatusPanel
        state={tracker.state}
        followPlayer={tracker.followPlayer}
        onToggleFollow={tracker.toggleFollowPlayer}
        autoMarkSkulltulas={tracker.autoMarkSkulltulas}
        onToggleAutoMark={tracker.toggleAutoMarkSkulltulas}
        toasts={tracker.toasts}
        onDismissToast={tracker.dismissToast}
        onJumpToPlayer={jumpToPlayer}
        onSelectItem={handleSelectItem}
        error={tracker.error}
        onRetry={tracker.refresh}
        isFullscreen={isFullscreen}
      />
    </main>
  )
}
