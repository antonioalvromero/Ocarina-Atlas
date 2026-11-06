import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { isUnplaced, itemsOfPlace, matchesAge, startMapOf } from '../lib/data'
import { gridPoint, layoutFloors } from '../lib/floorGrid'
import {
  addPin,
  ageFilterSlot,
  hiddenCategoriesSlot,
  officialDoneSlot,
  officialVisibleSlot,
  pinsSlot,
  useStored,
  type CustomPin,
} from '../lib/storage'
import type { Fraction, Item, Place, PlaceMap } from '../lib/types'
import { FloorGrid, type FloorDraft } from './FloorGrid'
import { MapViewport, type MapViewportHandle } from './MapViewport'
import { NewPinPopover } from './NewPinPopover'
import { CustomPinList, OfficialList, OfficialToggle, Section } from './Panels'
import { CustomMarker, DraftMarker, OfficialMarker } from './Pins'

type Selection = { kind: 'custom' | 'item'; id: string } | null

function useOfficialProgress(items: Item[]) {
  const doneIds = useStored(officialDoneSlot)
  const done = useMemo(() => new Set(doneIds), [doneIds])
  return { done, count: items.filter((item) => done.has(item.id)).length }
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
          {total > 0 && (
            <span className="tabular-nums"> · {progress}/{total} items</span>
          )}
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
  onChange,
  allFloors,
}: {
  maps: PlaceMap[]
  current: string | null
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
      {maps.map((map) => (
        <button
          key={map.id}
          type="button"
          aria-pressed={map.id === current}
          onClick={() => onChange(map.id)}
          className={`cursor-pointer px-3 py-1.5 text-sm ${
            map.id === current ? 'bg-parchment-200 font-medium text-ink-950' : 'text-parchment-200 hover:bg-ink-700'
          }`}
        >
          {map.label}
        </button>
      ))}
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
      title={`Your pins · ${map.label}`}
      hideWhenEmpty
    />
  )
}

function MappedPlace({ place, firstMap }: { place: Place; firstMap: PlaceMap }) {
  const [map, setMap] = useState(firstMap)
  const [selection, setSelection] = useState<Selection>(null)
  const [draft, setDraft] = useState<FloorDraft | null>(null)
  const [showAllFloors, setShowAllFloors] = useState(false)
  const viewport = useRef<MapViewportHandle>(null)

  const pins = useStored(pinsSlot(place.id, map.id))
  const showOfficial = useStored(officialVisibleSlot)
  const hidden = useStored(hiddenCategoriesSlot)
  const age = useStored(ageFilterSlot)

  const items = useMemo(() => itemsOfPlace(place.id), [place.id])
  const { done, count } = useOfficialProgress(items)
  const hasFloorGrid = place.kind === 'dungeon' && place.maps.length > 1
  const grid = useMemo(() => layoutFloors(place.maps), [place.maps])
  const allFloors = hasFloorGrid && showAllFloors
  const forAge = items.filter((item) => matchesAge(item, age))
  const onMap = forAge.filter((item) => (allFloors ? item.at : item.at?.map === map.id))
  const unplaced = forAge.filter((item) => isUnplaced(item, place))

  const selectedCustom = selection?.kind === 'custom' ? selection.id : null
  const selectedItem = selection?.kind === 'item' ? selection.id : null

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
  }

  function showGrid() {
    setShowAllFloors(true)
    setSelection(null)
    setDraft(null)
  }

  function createPin(name: string) {
    if (!draft) return
    const pin = addPin(place.id, draft.mapId, name, draft.at)
    setDraft(null)
    setSelection({ kind: 'custom', id: pin.id })
  }

  /** Where to centre for a point on a floor, in the view on screen. */
  function focusPoint(mapId: string, at: Fraction): Fraction | null {
    return allFloors ? gridPoint(grid, mapId, at) : at
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
            officialItems={showOfficial ? onMap.filter((item) => !hidden.includes(item.cat)) : []}
            done={done}
            selectedCustom={selectedCustom}
            selectedItem={selectedItem}
            onSelectCustom={(id) => toggleSelection({ kind: 'custom', id })}
            onSelectItem={(id) => toggleSelection({ kind: 'item', id })}
          />
        ) : (
          <MapViewport
            key={map.id}
            ref={viewport}
            image={map.image}
            alt={`Map of ${place.name}, ${map.label}`}
            aspect={map.aspect}
            onMapClick={(at) => {
              setDraft({ mapId: map.id, at })
              setSelection(null)
            }}
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
            {showOfficial &&
              onMap
                .filter((item) => !hidden.includes(item.cat))
                .map(
                  (item) =>
                    item.at && (
                      <OfficialMarker
                        key={item.id}
                        item={item}
                        at={item.at}
                        done={done.has(item.id)}
                        selected={item.id === selectedItem}
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
            {draft && <DraftMarker at={draft.at} />}
          </MapViewport>
        )}
        {place.maps.length > 1 && (
          <MapSwitcher
            maps={place.maps}
            current={allFloors ? null : map.id}
            onChange={changeMap}
            allFloors={hasFloorGrid ? { active: allFloors, onShow: showGrid } : undefined}
          />
        )}
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
          {showOfficial && (
            <OfficialList
              onMap={onMap}
              unplaced={unplaced}
              age={age}
              hidden={hidden}
              done={done}
              selectedId={selectedItem}
              onSelect={(item) =>
                toggleSelection({ kind: 'item', id: item.id }, item.at && focusPoint(item.at.map, item.at))
              }
            />
          )}
        </Section>
      </Sidebar>
    </main>
  )
}

function MaplessPlace({ place }: { place: Place }) {
  const [selected, setSelected] = useState<string | null>(null)
  const hidden = useStored(hiddenCategoriesSlot)
  const age = useStored(ageFilterSlot)
  const showOfficial = useStored(officialVisibleSlot)
  const items = useMemo(() => itemsOfPlace(place.id), [place.id])
  const { done, count } = useOfficialProgress(items)

  return (
    <main className="flex h-dvh flex-col bg-ink-950 lg:flex-row">
      <div className="grid flex-none place-items-center p-8 text-center lg:flex-1">
        <div className="max-w-sm rounded-lg border border-parchment-600/50 bg-ink-900 px-6 py-5">
          <h2 className="font-serif text-lg text-parchment-50">No map for this place</h2>
          <p className="mt-1 text-sm text-parchment-400">
            {items.length > 0
              ? 'Show official pins to track its items from the list. Custom pins need a map.'
              : 'There are no tracked items here either. Custom pins need a map.'}
          </p>
        </div>
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
