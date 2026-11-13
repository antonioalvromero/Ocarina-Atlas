import { Link } from '@tanstack/react-router'
import { Check, ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { GlobalProgressSummary } from '../lib/progress-stats'
import { categoryStyle } from './categories'

type LocationFilter = 'all' | 'incomplete' | 'zones' | 'dungeons'

const FILTER_TABS: { key: LocationFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'incomplete', label: 'Incomplete' },
  { key: 'zones', label: 'Zones' },
  { key: 'dungeons', label: 'Dungeons' },
]

export type GlobalStatsDrawerProps = {
  open: boolean
  onClose: () => void
  summary: GlobalProgressSummary
}

export function GlobalStatsDrawer({ open, onClose, summary }: GlobalStatsDrawerProps) {
  const [filter, setFilter] = useState<LocationFilter>('all')

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
              Global Progress
            </h2>
            <p className="mt-0.5 text-xs text-parchment-400">
              Hyrule completion across all zones and dungeons
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close global progress"
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
                {summary.completedPlaces} / {summary.totalPlaces} places completed
              </span>
            </div>
            <div
              className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full border border-ink-700 bg-ink-800"
              role="progressbar"
              aria-valuenow={summary.percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Overall completion"
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
            <h3 className="mb-2.5 font-serif text-sm font-medium tracking-wide text-parchment-50">
              By Category
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {summary.categories.map((category) => {
                const { icon: Icon, color } = categoryStyle(category.key)
                const complete = category.total > 0 && category.done === category.total
                return (
                  <div
                    key={category.key}
                    className="rounded-md border border-ink-700 bg-ink-950/60 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Icon
                          size={14}
                          style={{ color: complete ? 'var(--color-moss)' : color }}
                          className="shrink-0"
                        />
                        <span className="truncate text-xs font-medium text-parchment-200">
                          {category.name}
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
                  </div>
                )
              })}
            </div>
          </section>

          {/* By Location */}
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h3 className="font-serif text-sm font-medium tracking-wide text-parchment-50">
                By Location
              </h3>
              <span className="text-[11px] text-parchment-400 tabular-nums">
                {filteredPlaces.length} {filteredPlaces.length === 1 ? 'place' : 'places'}
              </span>
            </div>

            {/* Filter tabs */}
            <div
              role="tablist"
              aria-label="Filter locations"
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
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {/* Location list */}
            {filteredPlaces.length === 0 ? (
              <p className="rounded-md border border-ink-700/70 bg-ink-950/40 px-3 py-6 text-center text-xs text-parchment-400">
                {filter === 'incomplete'
                  ? 'All locations are 100% complete!'
                  : 'No locations match this filter.'}
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
                              {place.name}
                            </div>
                            <div className="truncate text-[11px] text-parchment-400">
                              {place.region}
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
}
