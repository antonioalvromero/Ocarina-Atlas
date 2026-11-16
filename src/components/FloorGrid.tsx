import { type MouseEvent, type ReactNode, type Ref } from 'react'
import { boxToFraction, isInsideImage, pinPosition } from '../lib/coords'
import { formatFloorLabel } from '../lib/data'
import { floorToGrid, type FloorCell, type FloorGrid as Grid } from '../lib/floorGrid'
import { useI18n, type TranslationKey } from '../lib/i18n'
import type { Merge } from '../lib/merge'
import { pinsSlot, useStored } from '../lib/storage'
import type { Fraction, Item, Place } from '../lib/types'
import { MapViewport, type MapViewportHandle, type Projection } from './MapViewport'
import { NewPinPopover } from './NewPinPopover'
import { CustomMarker, DraftMarker, MergeTrail, OfficialMarker } from './Pins'
import { PlayerPin } from './PlayerPin'

export type FloorDraft = { mapId: string; at: Fraction }

export type FloorPlayer = {
  mapId: string
  at: Fraction
  yaw?: number | null
  position3d?: { x: number; y: number; z: number } | null
  live?: boolean
  onClick?: () => void
}

type Shared = {
  placeId: string
  officialItems: Item[]
  done: Set<string>
  selectedCustom: string | null
  selectedItem: string | null
  merge: Merge | null
  player?: FloorPlayer | null
  onSelectCustom: (id: string, mapId: string) => void
  onSelectItem: (id: string) => void
}

function translateFloorLabel(labelOrId: string, t: (key: TranslationKey) => string): string {
  const formatted = formatFloorLabel(labelOrId)
  if (formatted === 'Child') return t('floor.child')
  if (formatted === 'Adult') return t('floor.adult')
  if (formatted === 'Main') return t('floor.main')
  return formatted
}

function Floor({
  cell,
  draft,
  onDraft,
  placeId,
  officialItems,
  done,
  selectedCustom,
  selectedItem,
  merge,
  player,
  onSelectCustom,
  onSelectItem,
}: Shared & { cell: FloorCell; draft: Fraction | null; onDraft: (at: Fraction) => void }) {
  const { t } = useI18n()
  const pins = useStored(pinsSlot(placeId, cell.map.id))
  const floorLabel = translateFloorLabel(cell.map.label, t)

  function onClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('[data-pin]')) return
    const rect = event.currentTarget.getBoundingClientRect()
    const at = boxToFraction({ x: event.clientX, y: event.clientY }, rect)
    if (isInsideImage(at)) onDraft(at)
  }

  return (
    <div
      className="absolute cursor-crosshair"
      data-floor={cell.map.id}
      style={{
        left: `${cell.left * 100}%`,
        top: `${cell.top * 100}%`,
        width: `${cell.width * 100}%`,
        height: `${cell.height * 100}%`,
      }}
      onClick={onClick}
    >
      <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-ink-900/90 px-2 py-0.5 text-xs font-medium text-parchment-200">
        {floorLabel}
      </span>
      <img src={cell.map.image} alt="" draggable={false} className="absolute inset-0 size-full max-w-none" />
      {officialItems.map(
        (item) =>
          item.at?.map === cell.map.id && (
            <OfficialMarker
              key={item.id}
              item={item}
              at={item.at}
              done={done.has(item.id)}
              selected={item.id === selectedItem}
              merge={merge}
              onSelect={() => onSelectItem(item.id)}
            />
          ),
      )}
      {pins.map((pin) => (
        <CustomMarker
          key={pin.id}
          pin={pin}
          selected={pin.id === selectedCustom}
          onSelect={() => onSelectCustom(pin.id, cell.map.id)}
        />
      ))}
      {draft && <DraftMarker at={draft} />}
      {merge?.mapId === cell.map.id && <MergeTrail key={merge.id} merge={merge} />}
      {player && player.mapId === cell.map.id && (
        <PlayerPin
          at={player.at}
          yaw={player.yaw}
          live={player.live}
          label={t('common.link')}
          sublabel={floorLabel}
          position3d={player.position3d}
          onClick={player.onClick}
        />
      )}
    </div>
  )
}

/** Every floor of a place on one pan and zoom surface. */
export function FloorGrid({
  place,
  grid,
  viewport,
  draft,
  onDraft,
  onDismiss,
  pinOverlay,
  onCreate,
  controlsAboveZoom,
  isFullscreen = false,
  ...shared
}: Omit<Shared, 'placeId'> & {
  place: Place
  grid: Grid
  viewport: Ref<MapViewportHandle>
  draft: FloorDraft | null
  onDraft: (draft: FloorDraft | null) => void
  onDismiss?: () => void
  pinOverlay?: (projection: Projection) => ReactNode
  onCreate: (type: string, name?: string) => void
  controlsAboveZoom?: ReactNode
  isFullscreen?: boolean
}) {
  const { t, tPlace } = useI18n()
  const draftCell = draft && grid.cells.find((cell) => cell.map.id === draft.mapId)
  return (
    <MapViewport
      ref={viewport}
      viewId={`${place.id}:all-floors`}
      alt={t('place.allFloorsAlt', { place: tPlace(place.id, place.name) })}
      aspect={grid.aspect}
      controlsAboveZoom={controlsAboveZoom}
      isFullscreen={isFullscreen}
      onDismiss={
        draft || onDismiss
          ? () => {
              onDraft(null)
              onDismiss?.()
            }
          : undefined
      }
      overlay={(projection) => (
        <>
          {draft && draftCell && (
            <NewPinPopover
              key={`${draft.mapId},${draft.at.x},${draft.at.y}`}
              at={floorToGrid(draftCell, draft.at)}
              projection={projection}
              onCancel={() => onDraft(null)}
              onCreate={onCreate}
            />
          )}
          {!draft && pinOverlay?.(projection)}
        </>
      )}
    >
      {grid.cells.map((cell) => (
        <Floor
          key={cell.map.id}
          {...shared}
          placeId={place.id}
          cell={cell}
          draft={draft?.mapId === cell.map.id ? draft.at : null}
          onDraft={(at) => onDraft({ mapId: cell.map.id, at })}
        />
      ))}
    </MapViewport>
  )
}
