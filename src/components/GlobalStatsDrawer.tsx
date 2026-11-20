import { Link } from '@tanstack/react-router'
import { Check, ChevronRight, Download, Eye, EyeOff, Info, Shield, Upload, Wrench, X } from 'lucide-react'
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { dataset, formatFloorLabel } from '../lib/data'
import { useI18n, type TranslationKey } from '../lib/i18n'
import {
  ALL_PREREQUISITE_KEYS,
  expandOwnedRequirements,
  meetsItemRequirements,
  type RequirementEvalOptions,
} from '../lib/prerequisites'
import type { GlobalProgressSummary } from '../lib/progress-stats'
import {
  activeProfileSlot,
  exportProgressBackup,
  hideDoneSlot,
  importProgressBackup,
  officialVisibleSlot,
  ownedPrereqsSlot,
  prereqFilterEnabledSlot,
  spoilerFreeSlot,
  useStored,
  write,
} from '../lib/storage'
import type { Dataset, Item } from '../lib/types'
import { useLichiiTracker } from '../lib/useLichiiTracker'
import { useModalFocusTrap } from '../lib/useModalFocusTrap'
import { categoryStyle } from './categories'
import { CreditsModal } from './CreditsModal'
import { GearChecklistModal } from './GearChecklistModal'

type LocationFilter = 'all' | 'incomplete' | 'zones' | 'dungeons'
type CategoryItemFilter = 'remaining' | 'all'

export function filterPlacesForDrawer(
  places: GlobalProgressSummary['places'],
  filter: LocationFilter,
  hideDone: boolean,
): GlobalProgressSummary['places'] {
  let base: GlobalProgressSummary['places']
  switch (filter) {
    case 'incomplete':
      base = places.filter((place) => place.done < place.total)
      break
    case 'zones':
      base = places.filter((place) => place.kind === 'zone')
      break
    case 'dungeons':
      base = places.filter((place) => place.kind === 'dungeon')
      break
    case 'all':
    default:
      base = places
  }
  if (hideDone) {
    return base.filter((place) => !(place.done === place.total && place.total > 0))
  }
  return base
}

export type CategoryDrawerItem = {
  item: Item
  placeName: string
  placeSlug: string
  mapId: string | null
  floorLabel: string | null
  done: boolean
}

export type CategoryDrawerFilterOptions = {
  onlyReachable?: boolean
  ownedExpanded?: ReadonlySet<string>
  beanEvalOptions?: Pick<RequirementEvalOptions, 'collectedBeanIds' | 'beanAutoSynced'>
}

export function getCategoryDrawerItems(
  categoryKey: string,
  doneIds: readonly string[],
  filter: CategoryItemFilter,
  sourceDataset: Dataset = dataset,
  options?: CategoryDrawerFilterOptions,
): CategoryDrawerItem[] {
  const doneSet = new Set(doneIds)
  const placeById = new Map(sourceDataset.places.map((place) => [place.id, place]))
  const entries: CategoryDrawerItem[] = []

  for (const item of sourceDataset.items) {
    if (item.cat !== categoryKey) continue
    const done = doneSet.has(item.id)
    if (filter === 'remaining' && done) continue
    if (
      options?.onlyReachable &&
      options.ownedExpanded &&
      !meetsItemRequirements(item, options.ownedExpanded, options.beanEvalOptions)
    ) {
      continue
    }
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

function GlobalStatsDrawerContent({
  onClose,
  summary,
  doneIds = [],
}: Omit<GlobalStatsDrawerProps, 'open'>) {
  const { t, tCategory, tPlace, tRegion, tItemName } = useI18n()
  const dialogRef = useRef<HTMLElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [filter, setFilter] = useState<LocationFilter>('all')
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null)
  const [categoryItemFilter, setCategoryItemFilter] = useState<CategoryItemFilter>('remaining')
  const [gearOpen, setGearOpen] = useState(false)
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [backupStatus, setBackupStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)

  const showOfficial = useStored(officialVisibleSlot)
  const hideDone = useStored(hideDoneSlot)
  const spoilerFree = useStored(spoilerFreeSlot)
  const prereqFilterEnabled = useStored(prereqFilterEnabledSlot)
  const ownedPrereqs = useStored(ownedPrereqsSlot)
  const activeProfile = useStored(activeProfileSlot)
  const tracker = useLichiiTracker({ trackPosition: false })

  useEffect(() => {
    if (!backupStatus) return
    const timer = window.setTimeout(() => setBackupStatus(null), 3500)
    return () => window.clearTimeout(timer)
  }, [backupStatus])

  function handleExportBackup() {
    const backup = exportProgressBackup()
    const date = new Date().toISOString().slice(0, 10)
    const safeProfile = (backup.activeProfile || activeProfile || 'default').replace(/[^a-zA-Z0-9._-]+/g, '-')
    const filename = `ocarina-atlas-backup-${safeProfile}-${date}.json`
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setBackupStatus({ kind: 'ok', message: t('backup.exported') })
  }

  async function handleImportBackupFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      importProgressBackup(text)
      setBackupStatus({ kind: 'ok', message: t('backup.imported') })
    } catch {
      setBackupStatus({ kind: 'error', message: t('backup.invalid') })
    }
  }

  const ownedCount = useMemo(() => {
    const ownedSet = new Set(ownedPrereqs)
    return ALL_PREREQUISITE_KEYS.filter((key) => ownedSet.has(key)).length
  }, [ownedPrereqs])
  const ownedExpanded = useMemo(() => expandOwnedRequirements(ownedPrereqs), [ownedPrereqs])
  const beanEvalOptions = useMemo(
    () =>
      tracker.prereqAutoSync && tracker.state.authoritativeBeans && tracker.state.collectedBeanIds
        ? { beanAutoSynced: true, collectedBeanIds: new Set(tracker.state.collectedBeanIds) }
        : undefined,
    [tracker.prereqAutoSync, tracker.state.authoritativeBeans, tracker.state.collectedBeanIds],
  )

  useModalFocusTrap(true, dialogRef, onClose)

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % FILTER_TABS.length
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + FILTER_TABS.length) % FILTER_TABS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = FILTER_TABS.length - 1
    }
    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = FILTER_TABS[nextIndex]
    if (!nextTab) return
    setFilter(nextTab.key)
    tabRefs.current[nextIndex]?.focus()
  }

  const filteredPlaces = useMemo(
    () => filterPlacesForDrawer(summary.places, filter, hideDone),
    [filter, summary.places, hideDone],
  )

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
        ? getCategoryDrawerItems(selectedCategoryKey, doneIds, categoryItemFilter, dataset, {
            onlyReachable: prereqFilterEnabled,
            ownedExpanded,
            beanEvalOptions,
          })
        : [],
    [selectedCategoryKey, doneIds, categoryItemFilter, prereqFilterEnabled, ownedExpanded, beanEvalOptions],
  )

  const allComplete = summary.totalItems > 0 && summary.totalDone === summary.totalItems

  return (
    <div
      className="fixed inset-0 z-50 flex bg-ink-950/75 backdrop-blur-xs"
      onClick={onClose}
      role="presentation"
    >
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-stats-title"
        data-overlay-open="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col border-r border-ink-600 bg-ink-900 text-parchment-200 shadow-2xl"
      >
        {/* Header */}
        <div className="border-b border-ink-700 px-5 py-4">
          <div className="flex items-center justify-between">
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
          <div className="mt-3 flex flex-col gap-2 border-t border-ink-700/80 pt-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={showOfficial}
              onClick={() => write(officialVisibleSlot, !showOfficial)}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-ink-700 bg-ink-800/60 px-2.5 py-1.5 text-xs text-parchment-200 transition-colors hover:border-ink-600 hover:text-parchment-50"
            >
              <span className="flex items-center gap-2">
                {showOfficial ? (
                  <Eye size={13} className="text-moss" aria-hidden />
                ) : (
                  <EyeOff size={13} className="text-parchment-400" aria-hidden />
                )}
                <span>{t('panel.showOfficialPins')}</span>
              </span>
              <span
                className={`relative h-4.5 w-8 shrink-0 rounded-full transition-colors ${
                  showOfficial ? 'bg-moss' : 'bg-ink-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-3.5 rounded-full bg-parchment-50 transition-transform ${
                    showOfficial ? 'translate-x-3.5' : ''
                  }`}
                />
              </span>
            </button>
            <button
              type="button"
              aria-pressed={spoilerFree}
              onClick={() => write(spoilerFreeSlot, !spoilerFree)}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-ink-700 bg-ink-800/60 px-2.5 py-1.5 text-xs text-parchment-200 transition-colors hover:border-ink-600 hover:text-parchment-50"
            >
              <span className="flex items-center gap-2">
                <Shield
                  size={13}
                  className={spoilerFree ? 'text-[#e8c04a]' : 'text-parchment-400'}
                  aria-hidden
                />
                <span>{t('filter.spoilerFree')}</span>
              </span>
              <span
                className={`relative h-4.5 w-8 shrink-0 rounded-full transition-colors ${
                  spoilerFree ? 'bg-moss' : 'bg-ink-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 size-3.5 rounded-full bg-parchment-50 transition-transform ${
                    spoilerFree ? 'translate-x-3.5' : ''
                  }`}
                />
              </span>
            </button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
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
                <button
                  type="button"
                  role="switch"
                  aria-checked={hideDone}
                  onClick={() => write(hideDoneSlot, !hideDone)}
                  className="flex cursor-pointer items-center gap-2 text-xs text-parchment-200"
                >
                  <span>{t('filter.hideCompleted')}</span>
                  <span
                    className={`relative h-4.5 w-8 rounded-full transition-colors ${
                      hideDone ? 'bg-moss' : 'bg-ink-600'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 size-3.5 rounded-full bg-parchment-50 transition-transform ${
                        hideDone ? 'translate-x-3.5' : ''
                      }`}
                    />
                  </span>
                </button>
              </div>
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
                        {prereqFilterEnabled
                          ? t('filter.reachableCount', { count: categoryItems.length })
                          : t('stats.remainingCount', { count: remainingCount })}
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
                      {prereqFilterEnabled &&
                      (categoryItemFilter === 'all' ? selectedCategory.total > 0 : remainingCount > 0)
                        ? `${t('filter.prereqNotice')} (${t('filter.reachableCount', { count: 0 })})`
                        : categoryItemFilter === 'remaining' && selectedCategory.total > 0
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
              {FILTER_TABS.map((tab, index) => {
                const active = filter === tab.key
                return (
                  <button
                    key={tab.key}
                    ref={(el) => {
                      tabRefs.current[index] = el
                    }}
                    id={`global-stats-tab-${tab.key}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="global-stats-locations-panel"
                    tabIndex={active ? 0 : -1}
                    onClick={() => setFilter(tab.key)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
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
            <div
              id="global-stats-locations-panel"
              role="tabpanel"
              aria-labelledby={`global-stats-tab-${filter}`}
              tabIndex={0}
            >
              {filteredPlaces.length === 0 ? (
              <p className="rounded-md border border-ink-700/70 bg-ink-950/40 px-3 py-6 text-center text-xs text-parchment-400">
                {filter === 'incomplete' ||
                (hideDone &&
                  summary.places.length > 0 &&
                  summary.places.every((place) => place.done === place.total && place.total > 0))
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
            </div>
          </section>
        </div>

        {/* Backup & Profiles toolbar */}
        <section
          aria-label={t('backup.title')}
          className="border-t border-ink-700 bg-ink-900/70 px-5 py-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-parchment-200">{t('backup.title')}</span>
            <span className="inline-flex items-center rounded-full border border-ink-600 bg-ink-950/80 px-2 py-0.5 text-[10px] font-medium text-parchment-300">
              {t('backup.activeProfile', { profile: activeProfile })}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportBackup}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-ink-600 bg-ink-800/90 px-2.5 py-1 text-[11px] font-medium text-parchment-200 transition-colors hover:border-[#e8c04a]/70 hover:text-parchment-50"
            >
              <Download size={12} className="text-[#e8c04a]" aria-hidden />
              <span>{t('backup.export')}</span>
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-ink-600 bg-ink-800/90 px-2.5 py-1 text-[11px] font-medium text-parchment-200 transition-colors hover:border-[#e8c04a]/70 hover:text-parchment-50"
            >
              <Upload size={12} className="text-[#e8c04a]" aria-hidden />
              <span>{t('backup.import')}</span>
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportBackupFile}
              aria-label={t('backup.import')}
              className="hidden"
            />
            {backupStatus && (
              <span
                role="status"
                className={`text-[11px] font-medium ${
                  backupStatus.kind === 'error' ? 'text-ember' : 'text-moss'
                }`}
              >
                {backupStatus.message}
              </span>
            )}
          </div>
        </section>

        {/* Credits footer */}
        <footer className="flex items-center justify-between gap-2 border-t border-ink-700 bg-ink-950/60 px-5 py-2.5 text-[11px] text-parchment-400">
          <span className="truncate">Ocarina Atlas · antonioalvromero · Nintendúo</span>
          <button
            type="button"
            onClick={() => setCreditsOpen(true)}
            aria-label={t('credits.title')}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border border-ink-600 bg-ink-800/90 px-2 py-1 text-[11px] font-medium text-parchment-200 transition-colors hover:border-[#e8c04a]/70 hover:text-parchment-50"
          >
            <Info size={12} className="text-[#e8c04a]" aria-hidden />
            <span>{t('credits.button')}</span>
          </button>
        </footer>
      </aside>
      <GearChecklistModal open={gearOpen} onClose={() => setGearOpen(false)} />
      <CreditsModal open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </div>
  )
}

export const GlobalStatsDrawer = memo(function GlobalStatsDrawer({
  open,
  onClose,
  summary,
  doneIds = [],
}: GlobalStatsDrawerProps) {
  if (!open) return null
  return <GlobalStatsDrawerContent onClose={onClose} summary={summary} doneIds={doneIds} />
})
