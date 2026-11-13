import { Link, useNavigate } from '@tanstack/react-router'
import { BarChart3, Check } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { pinPosition } from '../lib/coords'
import { dataset, formatFloorLabel } from '../lib/data'
import { computeGlobalProgress } from '../lib/progress-stats'
import { itemCountVisibleSlot, officialDoneSlot, useStored } from '../lib/storage'
import type { Place } from '../lib/types'
import { isLiveMemoryState, useLichiiTracker } from '../lib/useLichiiTracker'
import { GlobalStatsDrawer } from './GlobalStatsDrawer'
import { LichiiStatusPanel } from './LichiiStatusPanel'
import { MapViewport, type MapViewportHandle } from './MapViewport'
import { PlayerPin } from './PlayerPin'

const totals = new Map<string, number>()
for (const item of dataset.items) totals.set(item.place, (totals.get(item.place) ?? 0) + 1)

function PlaceLink({
  place,
  done,
  showCount,
  isPlayerHere,
  isPlayerLive,
}: {
  place: Place
  done: number
  showCount: boolean
  isPlayerHere?: boolean
  isPlayerLive?: boolean
}) {
  const total = totals.get(place.id) ?? 0
  const complete = total > 0 && done === total
  const dungeon = place.kind === 'dungeon'
  const progress = total === 0 ? 'no tracked items' : showCount ? `${done} of ${total} items completed` : null

  return (
    <div data-pin className="absolute size-0 hover:z-10 focus-within:z-10" style={pinPosition(place.pin)}>
      <Link
        to="/$zone"
        params={{ zone: place.slug }}
        draggable={false}
        aria-label={[place.name, dungeon ? 'dungeon' : 'zone', progress].filter(Boolean).join(', ')}
        className="group absolute -top-6 left-0 flex w-max -translate-x-1/2 cursor-pointer flex-col items-center rounded-lg"
      >
        <span className="grid size-12 place-items-center">
          <span
            className={`grid place-items-center border-2 shadow-md shadow-black/60 transition-transform group-hover:scale-125 group-focus-visible:scale-125 ${
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
            isPlayerHere
              ? isPlayerLive
                ? 'border-moss text-moss'
                : 'border-ember/70 text-parchment-50'
              : dungeon
                ? 'border-ember/70'
                : 'border-parchment-600/50'
          }`}
        >
          {place.name}
          {showCount && total > 0 && done > 0 && <span className="tabular-nums opacity-70">{done}/{total}</span>}
        </span>
      </Link>
    </div>
  )
}

export function WorldMap() {
  const navigate = useNavigate()
  const viewport = useRef<MapViewportHandle>(null)
  const doneIds = useStored(officialDoneSlot)
  const countsShown = useStored(itemCountVisibleSlot)
  const tracker = useLichiiTracker()
  const [statsOpen, setStatsOpen] = useState(false)

  const summary = useMemo(() => computeGlobalProgress(doneIds, dataset), [doneIds])
  const donePerPlace = useMemo(
    () => new Map(summary.places.map((place) => [place.id, place.done])),
    [summary.places],
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
  const playerWorldAt = tracker.state.worldMapFraction ?? activePlace?.pin ?? null
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

  function jumpToPlayer() {
    const slug = activePlace?.slug ?? tracker.state.placeSlug
    if (slug) {
      void navigate({ to: '/$zone', params: { zone: slug } })
    } else if (playerWorldAt) {
      viewport.current?.centerOn(playerWorldAt)
    }
  }

  return (
    <main className="relative h-dvh overflow-clip bg-ink-950">
      <img
        src="/content/maps/hyrule.webp"
        alt=""
        aria-hidden
        className="absolute inset-0 size-full scale-110 object-cover opacity-35 blur-2xl"
      />
      <MapViewport
        ref={viewport}
        viewId="world"
        image={dataset.map.image}
        alt="Map of Hyrule"
        aspect={dataset.map.width / dataset.map.height}
      >
        {dataset.places.map((place) => (
          <PlaceLink
            key={place.id}
            place={place}
            done={donePerPlace.get(place.id) ?? 0}
            showCount={countsShown.includes(place.id)}
            isPlayerHere={hasPlayerPin && activePlace?.id === place.id}
            isPlayerLive={isLiveMemory}
          />
        ))}
        {playerWorldAt && hasPlayerPin && (
          <PlayerPin
            at={playerWorldAt}
            yaw={tracker.state.position?.yaw}
            live={isLiveMemory}
            label="Link"
            sublabel={
              [
                activePlace?.name ?? tracker.state.placeName ?? tracker.state.scene,
                tracker.state.mapId && tracker.state.mapId !== 'principal'
                  ? formatFloorLabel(tracker.state.mapId)
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || null
            }
            position3d={tracker.state.position}
            onClick={jumpToPlayer}
          />
        )}
      </MapViewport>
      <header className="pointer-events-none absolute top-3 left-3 rounded-lg border border-ink-600 bg-ink-900/90 px-4 py-3 shadow-lg">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-serif text-xl text-parchment-50">Ocarina Atlas</h1>
          <button
            type="button"
            onClick={() => setStatsOpen(true)}
            aria-label="Open global progress stats"
            className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800/90 px-2.5 py-1 text-xs font-medium text-parchment-50 transition-colors hover:border-parchment-400 hover:bg-ink-700"
          >
            <BarChart3 size={13} className="text-[#e8c04a]" />
            Stats
          </button>
        </div>
        <div className="mt-1.5 flex items-center gap-2.5">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800"
            role="progressbar"
            aria-valuenow={summary.percentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Global completion"
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
        <ul className="mt-2 flex gap-4 text-xs text-parchment-200">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-parchment-200" /> Zone
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rotate-45 bg-ember" /> Dungeon
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-moss" /> Link
          </li>
        </ul>
      </header>
      <GlobalStatsDrawer open={statsOpen} onClose={() => setStatsOpen(false)} summary={summary} />
      <LichiiStatusPanel
        state={tracker.state}
        followPlayer={tracker.followPlayer}
        onToggleFollow={tracker.toggleFollowPlayer}
        autoMarkSkulltulas={tracker.autoMarkSkulltulas}
        onToggleAutoMark={tracker.toggleAutoMarkSkulltulas}
        toasts={tracker.toasts}
        onDismissToast={tracker.dismissToast}
        onJumpToPlayer={jumpToPlayer}
        error={tracker.error}
        onRetry={tracker.refresh}
      />
    </main>
  )
}
