import { Link } from '@tanstack/react-router'
import { Check, ChevronRight, X } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import { dataset, formatFloorLabel } from '../lib/data'
import { useI18n, type TranslationKey } from '../lib/i18n'
import type { GlobalProgressSummary } from '../lib/progress-stats'
import type { Dataset, Item } from '../lib/types'
import { categoryStyle } from './categories'

type LocationFilter = 'all' | 'incomplete' | 'zones' | 'dungeons'
type CategoryItemFilter = 'remaining' | 'all'

export type CategoryDrawerItem = {
  item: Item
  placeName: string
  placeSlug: string
  mapId: string | null
  floorLabel: string | null
  done: boolean
}

export function getCategoryDrawerItems(
  categoryKey: string,
  doneIds: readonly string[],
  filter: CategoryItemFilter,
  sourceDataset: Dataset = dataset,
): CategoryDrawerItem[] {
  const doneSet = new Set(doneIds)
  const placeById = new Map(sourceDataset.places.map((place) => [place.id, place]))
  const entries: CategoryDrawerItem[] = []

  for (const item of sourceDataset.items) {
    if (item.cat !== categoryKey) continue
    const done = doneSet.has(item.id)
    if (filter === 'remaining' && done) continue
    const place = placeById.get(item.place)
    if (!place) continue

    const mapId = item.at?.map ?? null
    const floorLabel = mapId && mapId !== 'principal' ? formatFloorLabel(mapId) : null

    entries.push({
      item,
      placeName: place.name,
      placeSlug: place.slug,
      mapId,
      floorLabel,
      done,
    })
  }

  return entries
}

const FILTER_TABS: { key: LocationFilter; labelKey: TranslationKey }[] = [
  { key: 'all', labelKey: 'stats.tabAll' },
  { key: 'incomplete', labelKey: 'stats.tabIncomplete' },
  { key: 'zones', labelKey: 'stats.tabZones' },
  { key: 'dungeons', labelKey: 'stats.tabDungeons' },
]

export type GlobalStatsDrawerProps = {
  open: boolean
  onClose: () => void
  summary: GlobalProgressSummary
  doneIds?: readonly string[]
}

export const GlobalStatsDrawer = memo(function GlobalStatsDrawer({
  open,
  onClose,
  summary,
  doneIds = [],
}: GlobalStatsDrawerProps) {
  const { t, tCategory, tPlace, tRegion, tItemName } = useI18n()
  const [filter, setFilter] = useState<LocationFilter>('all')
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null)
  const [categoryItemFilter, setCategoryItemFilter] = useState<CategoryItemFilter>('remaining')

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const filteredPlaces = useMemo(() => {
    switch (filter) {
      case 'incomplete':
        return summary.places.filter((place) => place.done < place.total)
      case 'zones':
        return summary.places.filter((place) => place.kind === 'zone')
      case 'dungeons':
        return summary.places.filter((place) => place.kind === 'dungeon')
      case 'all':
      default:
        return summary.places
    }
  }, [filter, summary.places])

  const selectedCategory = useMemo(
    () =>
      selectedCategoryKey
        ? summary.categories.find((category) => category.key === selectedCategoryKey) ?? null
        : null,
    [selectedCategoryKey, summary.categories],
  )

  const categoryItems = useMemo(
    () =>
      selectedCategoryKey
        ? getCategoryDrawerItems(selectedCategoryKey, doneIds, categoryItemFilter)
        : [],
    [selectedCategoryKey, doneIds, categoryItemFilter],
  )

  if (!open) return null

  const allComplete = summary.totalItems > 0 && summary.totalDone === summary.totalItems

  return (
    <div
      className="fixed inset-0 z-50 flex bg-ink-950/75 backdrop-blur-xs"
      onClick={onClose}
      role="presentation"
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-stats-title"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col border-r border-ink-600 bg-ink-900 text-parchment-200 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
          <div>
            <h2 id="global-stats-title" className="font-serif text-xl text-parchment-50">
              {t('stats.title')}
            </h2>
            <p className="mt-0.5 text-xs text-parchment-400">
              {t('stats.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('stats.close')}
            className="grid size-8 cursor-pointer place-items-center rounded-md border border-ink-700 bg-ink-800/80 text-parchment-200 transition-colors hover:border-parchment-400 hover:bg-ink-700 hover:text-parchment-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {/* Overall progress */}
          <section className="rounded-lg border border-ink-700 bg-ink-950/70 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-lg font-semibold text-parchment-50 tabular-nums">
                {summary.totalDone} / {summary.totalItems}{' '}
                <span className="text-sm font-medium text-[#e8c04a]">· {summary.percentage}%</span>
              </span>
              <span className="text-xs text-parchment-400 tabular-nums">
                {t('stats.placesCompleted', { done: summary.completedPlaces, total: summary.totalPlaces })}
              </span>
            </div>
            <div
              className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full border border-ink-700 bg-ink-800"
              role="progressbar"
              aria-valuenow={summary.percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('stats.overallCompletion')}
            >
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  allComplete ? 'bg-moss' : 'bg-[#e8c04a]'
                }`}
                style={{ width: `${summary.percentage}%` }}
              />
            </div>
          </section>

          {/* By Category */}
          <section>
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h3 className="font-serif text-sm font-medium tracking-wide text-parchment-50">
                {t('stats.byCategory')}
              </h3>
              <span className="text-[11px] text-parchment-400">
                {selectedCategory ? t('stats.clickAgainToClear') : t('stats.selectToViewItems')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {summary.categories.map((category) => {
                const { icon: Icon, color } = categoryStyle(category.key)
                const complete = category.total > 0 && category.done === category.total
                const isSelected = selectedCategoryKey === category.key
                const categoryLabel = tCategory(category.key, category.name)
                return (
                  <button
                    key={category.key}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() =>
                      setSelectedCategoryKey((prev) => (prev === category.key ? null : category.key))
                    }
                    className={`cursor-pointer rounded-md border p-2.5 text-left transition-colors ${
                      isSelected
                        ? 'border-[#e8c04a] bg-ink-800/90 ring-1 ring-[#e8c04a]/35'
                        : 'border-ink-700 bg-ink-950/60 hover:border-parchment-400/70 hover:bg-ink-800/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Icon
                          size={14}
                          style={{ color: complete ? 'var(--color-moss)' : color }}
                          className="shrink-0"
                        />
                        <span className="truncate text-xs font-medium text-parchment-200">
                          {categoryLabel}
                        </span>
                      </div>
                      <span
                        className={`shrink-0 text-[11px] font-medium tabular-nums ${
                          complete ? 'text-moss' : 'text-parchment-400'
                        }`}
                      >
                        {category.done}/{category.total}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          complete ? 'bg-moss' : ''
                        }`}
                        style={{
                          width: `${category.percentage}%`,
                          ...(complete ? {} : { backgroundColor: color }),
                        }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>

            {selectedCategory && (() => {
              const { icon: SelectedIcon, color: selectedColor } = categoryStyle(selectedCategory.key)
              const remainingCount = Math.max(0, selectedCategory.total - selectedCategory.done)
              const selectedCategoryLabel = tCategory(selectedCategory.key, selectedCategory.name)
              return (
                <div className="mt-3 rounded-lg border border-ink-700 bg-ink-950/75 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <SelectedIcon size={14} style={{ color: selectedColor }} className="shrink-0" />
                      <h4 className="truncate text-xs font-semibold text-parchment-50">
                        {selectedCategoryLabel}
                      </h4>
                      <span className="shrink-0 text-[11px] text-parchment-400 tabular-nums">
                        {t('stats.remainingCount', { count: remainingCount })}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <div
                        role="group"
                        aria-label={t('stats.filterCategoryItems')}
                        className="flex rounded border border-ink-700 bg-ink-900 p-0.5 text-[11px]"
                      >
                        <button
                          type="button"
                          aria-pressed={categoryItemFilter === 'remaining'}
                          onClick={() => setCategoryItemFilter('remaining')}
                          className={`cursor-pointer rounded px-1.5 py-0.5 font-medium transition-colors ${
                            categoryItemFilter === 'remaining'
                              ? 'bg-parchment-200 text-ink-950'
                              : 'text-parchment-400 hover:text-parchment-50'
                          }`}
                        >
                          {t('stats.remaining')}
                        </button>
                        <button
                          type="button"
                          aria-pressed={categoryItemFilter === 'all'}
                          onClick={() => setCategoryItemFilter('all')}
                          className={`cursor-pointer rounded px-1.5 py-0.5 font-medium transition-colors ${
                            categoryItemFilter === 'all'
                              ? 'bg-parchment-200 text-ink-950'
                              : 'text-parchment-400 hover:text-parchment-50'
                          }`}
                        >
                          {t('stats.all')}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedCategoryKey(null)}
                        aria-label={t('stats.closeCategoryItems', { category: selectedCategoryLabel })}
                        className="grid size-6 cursor-pointer place-items-center rounded text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-50"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>

                  {categoryItems.length === 0 ? (
                    <p className="mt-2.5 rounded border border-ink-700/70 bg-ink-900/50 px-3 py-4 text-center text-xs text-parchment-400">
                      {categoryItemFilter === 'remaining' && selectedCategory.total > 0
                        ? t('stats.allCollected', { category: selectedCategoryLabel })
                        : t('stats.noItemsInCategory')}
                    </p>
                  ) : (
                    <ul className="mt-2.5 flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
                      {categoryItems.map(({ item, placeName, placeSlug, mapId, floorLabel, done }) => {
                        const localizedFloor =
                          mapId === 'nino'
                            ? t('floor.child')
                            : mapId === 'adulto'
                              ? t('floor.adult')
                              : mapId === 'principal'
                                ? t('floor.main')
                                : floorLabel
                        return (
                          <li key={item.id}>
                            <Link
                              to="/$zone"
                              params={{ zone: placeSlug }}
                              search={{ item: item.id, ...(mapId ? { map: mapId } : {}) }}
                              onClick={onClose}
                              className="group flex items-center justify-between gap-2 rounded-md border border-ink-700/80 bg-ink-900/70 px-2.5 py-1.5 transition-colors hover:border-parchment-400/70 hover:bg-ink-800/80"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  aria-label={done ? t('stats.collected') : t('stats.remaining')}
                                  className={`grid size-3.5 shrink-0 place-items-center rounded-full border ${
                                    done
                                      ? 'border-moss bg-moss text-ink-950'
                                      : 'border-parchment-600 bg-ink-950'
                                  }`}
                                >
                                  {done && <Check size={9} strokeWidth={4} />}
                                </span>
                                <div className="min-w-0">
                                  <div
                                    className={`truncate text-xs font-medium ${
                                      done ? 'text-parchment-400 line-through' : 'text-parchment-50'
                                    }`}
                                  >
                                    {tItemName(item.id, item.name)}
                                  </div>
                                  <div className="truncate text-[11px] text-parchment-400">
                                    {tPlace(item.place, placeName)}
                                    {localizedFloor ? ` · ${localizedFloor}` : ''}
                                  </div>
                                </div>
                              </div>
                              <ChevronRight
                                size={13}
                                className="shrink-0 text-parchment-600 transition-transform group-hover:translate-x-0.5 group-hover:text-parchment-200"
                              />
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })()}
          </section>

          {/* By Location */}
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h3 className="font-serif text-sm font-medium tracking-wide text-parchment-50">
                {t('stats.byLocation')}
              </h3>
              <span className="text-[11px] text-parchment-400 tabular-nums">
                {filteredPlaces.length}{' '}
                {filteredPlaces.length === 1 ? t('stats.placeSingular') : t('stats.placePlural')}
              </span>
            </div>

            {/* Filter tabs */}
            <div
              role="tablist"
              aria-label={t('stats.filterLocations')}
              className="mb-2.5 grid grid-cols-4 gap-1 rounded-md border border-ink-700 bg-ink-950/70 p-1"
            >
              {FILTER_TABS.map((tab) => {
                const active = filter === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFilter(tab.key)}
                    className={`cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-parchment-200 text-ink-950'
                        : 'text-parchment-400 hover:bg-ink-800/70 hover:text-parchment-50'
                    }`}
                  >
                    {t(tab.labelKey)}
                  </button>
                )
              })}
            </div>

            {/* Location list */}
            {filteredPlaces.length === 0 ? (
              <p className="rounded-md border border-ink-700/70 bg-ink-950/40 px-3 py-6 text-center text-xs text-parchment-400">
                {filter === 'incomplete'
                  ? t('stats.allLocationsComplete')
                  : t('stats.noLocationsMatch')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5 pb-2">
                {filteredPlaces.map((place) => {
                  const complete = place.total > 0 && place.done === place.total
                  const dungeon = place.kind === 'dungeon'
                  return (
                    <li key={place.id}>
                      <Link
                        to="/$zone"
                        params={{ zone: place.slug }}
                        onClick={onClose}
                        className="group flex items-center justify-between gap-3 rounded-md border border-ink-700/80 bg-ink-950/60 px-3 py-2 transition-colors hover:border-parchment-400/70 hover:bg-ink-800/80"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={`grid size-3.5 shrink-0 place-items-center border border-ink-950 ${
                              dungeon ? 'rotate-45 bg-ember' : 'rounded-full bg-parchment-200'
                            } ${complete ? 'bg-moss!' : ''}`}
                          >
                            {complete && (
                              <Check
                                size={9}
                                strokeWidth={4}
                                className={`text-ink-950 ${dungeon ? '-rotate-45' : ''}`}
                              />
                            )}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium text-parchment-50 group-hover:text-parchment-50">
                              {tPlace(place.id, place.name)}
                            </div>
                            <div className="truncate text-[11px] text-parchment-400">
                              {tRegion(place.region)}
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2.5">
                          <div className="w-20 text-right">
                            <span
                              className={`text-xs font-medium tabular-nums ${
                                complete ? 'text-moss' : 'text-parchment-200'
                              }`}
                            >
                              {place.done}/{place.total}
                            </span>
                            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-800">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  complete ? 'bg-moss' : 'bg-[#e8c04a]'
                                }`}
                                style={{ width: `${place.percentage}%` }}
                              />
                            </div>
                          </div>
                          <ChevronRight
                            size={14}
                            className="text-parchment-600 transition-transform group-hover:translate-x-0.5 group-hover:text-parchment-200"
                          />
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
})
