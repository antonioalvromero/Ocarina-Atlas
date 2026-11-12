import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { dataset, formatFloorLabel, isUnplaced, itemsOfPlace, matchesAge, startMapOf } from '../lib/data'
import { floorToGrid, gridPoint, layoutFloors } from '../lib/floorGrid'
import { findMerge, type Merge } from '../lib/merge'
import { OTHER_PIN, pinTypeLabel } from '../lib/pinTypes'
import {
  addPin,
  ageFilterSlot,
  hiddenCategoriesSlot,
  itemCountVisibleSlot,
  officialDoneSlot,
  officialRevealedSlot,
  officialVisibleSlot,
  pinsSlot,
  setInList,
  toggleInList,
  useStored,
  write,
  type CustomPin,
} from '../lib/storage'
import type { Fraction, Item, Place, PlaceMap } from '../lib/types'
import { isLiveMemoryState, useLichiiTracker } from '../lib/useLichiiTracker'
import { FloorGrid, type FloorDraft } from './FloorGrid'
import { LichiiStatusPanel } from './LichiiStatusPanel'
import { MapViewport, type MapViewportHandle } from './MapViewport'
import { MergeNotice } from './MergeNotice'
import { NewPinPopover } from './NewPinPopover'
import { CustomPinList, OfficialList, OfficialToggle, RevealedList, Section } from './Panels'
import { CustomMarker, DraftMarker, MergeTrail, OfficialMarker } from './Pins'
import { PlayerPin } from './PlayerPin'

type Selection = { kind: 'custom' | 'item'; id: string } | null

function useOfficialProgress(items: Item[]) {
  const doneIds = useStored(officialDoneSlot)
  const done = useMemo(() => new Set(doneIds), [doneIds])
  return { done, count: items.filter((item) => done.has(item.id)).length }
}

function ItemCount({ placeId, progress, total }: { placeId: string; progress: number; total: number }) {
  const shown = useStored(itemCountVisibleSlot).includes(placeId)
  return (
    <>
      {' · '}
      {shown && <span className="tabular-nums">{progress}/{total} items · </span>}
      <button
        type="button"
        onClick={() => toggleInList(itemCountVisibleSlot, placeId)}
        className="cursor-pointer underline hover:text-parchment-50"
      >
        {shown ? 'Hide' : 'Show item count'}
      </button>
    </>
  )
}

function Sidebar({ place, progress, total, children }: { place: Place; progress: number; total: number; children: ReactNode }) {
  return (
    <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto border-ink-700 bg-ink-900 max-lg:border-t lg:w-96 lg:flex-none lg:border-l">
      <header className="px-4 pt-3 pb-3">
        <Link to="/" className="inline-flex items-center gap-1 text-xs text-parchment-400 hover:text-parchment-50">
          <ArrowLeft size={13} /> Atlas
        </Link>
        <h1 className="mt-1.5 font-serif text-2xl leading-tight text-parchment-50">{place.name}</h1>
        <p className="mt-0.5 text-xs text-parchment-400">
          <span className={place.kind === 'dungeon' ? 'text-ember' : ''}>
            {place.kind === 'dungeon' ? 'Dungeon' : 'Zone'}
          </span>{' '}
          in {place.region}
          {total > 0 && <ItemCount placeId={place.id} progress={progress} total={total} />}
        </p>
        <details className="mt-2 text-sm leading-relaxed text-parchment-200">
          <summary className="cursor-pointer text-xs text-parchment-400 hover:text-parchment-50">About this place</summary>
          <p className="mt-1">{place.intro}</p>
        </details>
      </header>
      {children}
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
}: {
  maps: PlaceMap[]
  current: string | null
  playerMapId?: string | null
  playerLive?: boolean
  onChange: (id: string) => void
  allFloors?: { active: boolean; onShow: () => void }
}) {
  return (
    <div role="group" aria-label="Choose a map" className="absolute top-3 left-3 z-30 flex overflow-hidden rounded-lg border border-ink-600 bg-ink-900/90 shadow-lg">
      {allFloors && (
        <button
          type="button"
          aria-pressed={allFloors.active}
          onClick={allFloors.onShow}
          className={`cursor-pointer px-3 py-1.5 text-sm ${
            allFloors.active ? 'bg-parchment-200 font-medium text-ink-950' : 'text-parchment-200 hover:bg-ink-700'
          }`}
        >
          All floors
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
            className={` inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-sm ${
              map.id === current ? 'bg-parchment-200 font-medium text-ink-950' : 'text-parchment-200 hover:bg-ink-700'
            }`}
          >
            {hasPlayer && (
              <span
                title={playerLive ? 'Link is on this floor' : 'Link is on this floor (Saved)'}
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
            {formatFloorLabel(map.label)}
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
  const pins = useStored(pinsSlot(place.id, map.id))
  return (
    <CustomPinList
      pins={pins}
      placeId={place.id}
      mapId={map.id}
      selectedId={selectedId}
      onSelect={onSelect}
      title={`Your pins · ${formatFloorLabel(map.label)}`}
      hideWhenEmpty
    />
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

function MappedPlace({ place, firstMap }: { place: Place; firstMap: PlaceMap }) {
  const navigate = useNavigate()
  const tracker = useLichiiTracker()
  const isLiveMemory = isLiveMemoryState(tracker.state)
  const hasPlayerPin = isLiveMemory || tracker.state.source === 'save'
  const isPlayerInPlace =
    hasPlayerPin &&
    (tracker.state.placeId === place.id || tracker.state.placeSlug === place.slug)
  const playerMapId = isPlayerInPlace
    ? resolvePlayerMapId(place, tracker.state.mapId, tracker.state.age)
    : null

  const [map, setMap] = useState<PlaceMap>(() => {
    if (playerMapId) {
      const matched = place.maps.find((candidate) => candidate.id === playerMapId)
      if (matched) return matched
    }
    return firstMap
  })
  const [selection, setSelection] = useState<Selection>(null)
  const [draft, setDraft] = useState<FloorDraft | null>(null)
  const [showAllFloors, setShowAllFloors] = useState(false)
  const [merge, setMerge] = useState<Merge | null>(null)
  const viewport = useRef<MapViewportHandle>(null)

  const pins = useStored(pinsSlot(place.id, map.id))
  const showOfficial = useStored(officialVisibleSlot)
  const hidden = useStored(hiddenCategoriesSlot)
  const age = useStored(ageFilterSlot)
  const revealedIds = useStored(officialRevealedSlot)
  const revealed = useMemo(() => new Set(revealedIds), [revealedIds])

  const items = useMemo(() => itemsOfPlace(place.id), [place.id])
  const { done, count } = useOfficialProgress(items)
  const hasFloorGrid = place.kind === 'dungeon' && place.maps.length > 1
  const grid = useMemo(() => layoutFloors(place.maps), [place.maps])
  const allFloors = hasFloorGrid && showAllFloors
  const inView = items.filter((item) => (allFloors ? item.at : item.at?.map === map.id))
  const onMap = inView.filter((item) => matchesAge(item, age))
  const unplaced = items.filter((item) => matchesAge(item, age) && isUnplaced(item, place))
  // With official pins off, only reveals count, and no filter can hide those.
  const isShown = (item: Item) =>
    showOfficial ? matchesAge(item, age) && !hidden.includes(item.cat) : revealed.has(item.id)
  const shownOnMap = inView.filter(isShown)

  const selectedCustom = selection?.kind === 'custom' ? selection.id : null
  const selectedItem = selection?.kind === 'item' ? selection.id : null

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

  function toggleSelection(next: NonNullable<Selection>, focus?: Fraction | null) {
    const closing = selection?.kind === next.kind && selection.id === next.id
    setSelection(closing ? null : next)
    setDraft(null)
    if (!closing && focus) viewport.current?.centerOn(focus)
  }

  function changeMap(id: string) {
    const next = place.maps.find((candidate) => candidate.id === id)
    if (!next) return
    setMap(next)
    setShowAllFloors(false)
    setSelection(null)
    setDraft(null)
    setMerge(null)
  }

  function showGrid() {
    setShowAllFloors(true)
    setSelection(null)
    setDraft(null)
    setMerge(null)
  }

  function mergeInto(item: Item, to: Fraction, type: string, name: string, from: FloorDraft) {
    const unhid = showOfficial && hidden.includes(item.cat)
    const previousAge = showOfficial && !matchesAge(item, age) ? age : null
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
    setInList(officialRevealedSlot, item.id, true)
    if (unhid) setInList(hiddenCategoriesSlot, item.cat, false)
    if (previousAge) write(ageFilterSlot, 'both')
    setDraft(null)
    setSelection(null)
  }

  function createPin(type: string, name = pinTypeLabel(type)) {
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
    setSelection({ kind: 'custom', id: pin.id })
  }

  function undoMerge() {
    if (!merge) return
    if (merge.revealed) setInList(officialRevealedSlot, merge.item.id, false)
    if (merge.unhid) setInList(hiddenCategoriesSlot, merge.item.cat, true)
    if (merge.previousAge) write(ageFilterSlot, merge.previousAge)
    const pin = addPin(place.id, merge.mapId, merge.name, merge.from, merge.type)
    setMerge(null)
    setSelection({ kind: 'custom', id: pin.id })
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
    const targetAt = tracker.state.mapFraction
    if (targetAt) {
      viewport.current?.centerOn(targetAt)
      setTimeout(() => viewport.current?.centerOn(targetAt), 0)
    }
  }

  return (
    <main className="flex h-dvh flex-col bg-ink-950 lg:flex-row">
      <div className="relative min-h-0 flex-[1.3] lg:flex-1">
        {allFloors ? (
          <FloorGrid
            place={place}
            grid={grid}
            viewport={viewport}
            draft={draft}
            onDraft={(next) => {
              setDraft(next)
              if (next) setSelection(null)
            }}
            onCreate={createPin}
            officialItems={shownOnMap}
            done={done}
            selectedCustom={selectedCustom}
            selectedItem={selectedItem}
            merge={merge}
            player={
              isPlayerInPlace && playerMapId && tracker.state.mapFraction
                ? {
                    mapId: playerMapId,
                    at: tracker.state.mapFraction,
                    yaw: tracker.state.position?.yaw,
                    position3d: tracker.state.position,
                    live: isLiveMemory,
                    onClick: () => {
                      const cell = grid.cells.find((c) => c.map.id === playerMapId)
                      if (cell && tracker.state.mapFraction) {
                        viewport.current?.centerOn(floorToGrid(cell, tracker.state.mapFraction))
                      }
                    },
                  }
                : null
            }
            onSelectCustom={(id) => toggleSelection({ kind: 'custom', id })}
            onSelectItem={(id) => toggleSelection({ kind: 'item', id })}
          />
        ) : (
          <MapViewport
            key={map.id}
            ref={viewport}
            viewId={`${place.id}:${map.id}`}
            image={map.image}
            alt={`Map of ${place.name}, ${formatFloorLabel(map.label)}`}
            aspect={map.aspect}
            onMapClick={(at) => {
              setDraft({ mapId: map.id, at })
              setSelection(null)
            }}
            onDismiss={draft ? () => setDraft(null) : undefined}
            overlay={(projection) =>
              draft && (
                <NewPinPopover
                  key={`${draft.at.x},${draft.at.y}`}
                  at={draft.at}
                  projection={projection}
                  onCancel={() => setDraft(null)}
                  onCreate={createPin}
                />
              )
            }
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
                    onSelect={() => toggleSelection({ kind: 'item', id: item.id })}
                  />
                ),
            )}
            {pins.map((pin) => (
              <CustomMarker
                key={pin.id}
                pin={pin}
                selected={pin.id === selectedCustom}
                onSelect={() => toggleSelection({ kind: 'custom', id: pin.id })}
              />
            ))}
            {isPlayerInPlace &&
              playerMapId === map.id &&
              tracker.state.mapFraction && (
                <PlayerPin
                  at={tracker.state.mapFraction}
                  yaw={tracker.state.position?.yaw}
                  live={isLiveMemory}
                  label="Link"
                  sublabel={formatFloorLabel(map.label)}
                  position3d={tracker.state.position}
                  onClick={() =>
                    tracker.state.mapFraction && viewport.current?.centerOn(tracker.state.mapFraction)
                  }
                />
              )}
            {draft && <DraftMarker at={draft.at} />}
            {merge && <MergeTrail key={merge.id} merge={merge} />}
          </MapViewport>
        )}
        {place.maps.length > 1 && (
          <MapSwitcher
            maps={place.maps}
            current={allFloors ? null : map.id}
            playerMapId={playerMapId}
            playerLive={isLiveMemory}
            onChange={changeMap}
            allFloors={hasFloorGrid ? { active: allFloors, onShow: showGrid } : undefined}
          />
        )}
        {merge && (
          <MergeNotice
            key={merge.id}
            merge={merge}
            done={done.has(merge.item.id)}
            onComplete={() => setInList(officialDoneSlot, merge.item.id, true)}
            onUndo={undoMerge}
            onDismiss={() => setMerge(null)}
          />
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
        />
      </div>

      <Sidebar place={place} progress={count} total={items.length}>
        {allFloors ? (
          <>
            <Section title="Your pins">
              <p className="text-sm text-parchment-400">Click any floor to add a pin.</p>
            </Section>
            {place.maps.map((floor) => (
              <FloorPinList
                key={floor.id}
                place={place}
                map={floor}
                selectedId={selectedCustom}
                onSelect={(pin) => toggleSelection({ kind: 'custom', id: pin.id }, focusPoint(floor.id, pin))}
              />
            ))}
          </>
        ) : (
          <CustomPinList
            pins={pins}
            placeId={place.id}
            mapId={map.id}
            selectedId={selectedCustom}
            onSelect={(pin) => toggleSelection({ kind: 'custom', id: pin.id }, pin)}
          />
        )}
        <Section title="Official pins" aside={<OfficialToggle on={showOfficial} />}>
          {showOfficial ? (
            <OfficialList
              onMap={onMap}
              unplaced={unplaced}
              age={age}
              hidden={hidden}
              done={done}
              selectedId={selectedItem}
              onSelect={selectOfficial}
            />
          ) : (
            <RevealedList items={shownOnMap} done={done} selectedId={selectedItem} onSelect={selectOfficial} />
          )}
        </Section>
      </Sidebar>
    </main>
  )
}

function MaplessPlace({ place }: { place: Place }) {
  const navigate = useNavigate()
  const tracker = useLichiiTracker()
  const isLiveMemory = isLiveMemoryState(tracker.state)
  const [selected, setSelected] = useState<string | null>(null)
  const hidden = useStored(hiddenCategoriesSlot)
  const age = useStored(ageFilterSlot)
  const showOfficial = useStored(officialVisibleSlot)
  const items = useMemo(() => itemsOfPlace(place.id), [place.id])
  const { done, count } = useOfficialProgress(items)

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
    <main className="flex h-dvh flex-col bg-ink-950 lg:flex-row">
      <div className="relative grid flex-none place-items-center p-8 text-center lg:flex-1">
        <div className="max-w-sm rounded-lg border border-parchment-600/50 bg-ink-900 px-6 py-5">
          <h2 className="font-serif text-lg text-parchment-50">No map for this place</h2>
          <p className="mt-1 text-sm text-parchment-400">
            {items.length > 0
              ? 'Show official pins to track its items from the list. Custom pins need a map.'
              : 'There are no tracked items here either. Custom pins need a map.'}
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
      <Sidebar place={place} progress={count} total={items.length}>
        {items.length > 0 && (
          <Section title="Official pins" aside={<OfficialToggle on={showOfficial} />}>
            {showOfficial && (
              <OfficialList
                onMap={[]}
                unplaced={items.filter((item) => matchesAge(item, age))}
                age={age}
                hidden={hidden}
                done={done}
                selectedId={selected}
                onSelect={(item) => setSelected((id) => (id === item.id ? null : item.id))}
              />
            )}
          </Section>
        )}
      </Sidebar>
    </main>
  )
}

export function PlaceView({ place }: { place: Place }) {
  const firstMap = startMapOf(place)
  return firstMap ? <MappedPlace place={place} firstMap={firstMap} /> : <MaplessPlace place={place} />
}
