import { Check, Compass, CornerDownLeft, MapPin, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
import {
  getQuickBrowsePlaces,
  searchAtlas,
  type ItemSearchResult,
  type PlaceSearchResult,
} from '../lib/search'
import { categoryStyle } from './categories'

export type QuickSearchTarget =
  | { kind: 'place'; slug: string; placeId: string }
  | { kind: 'item'; placeSlug: string; placeId: string; itemId: string }

export type QuickSearchModalProps = {
  open: boolean
  onOpen?: () => void
  onClose: () => void
  onNavigate: (target: QuickSearchTarget) => void
  doneIds?: readonly string[]
  initialQuery?: string
}

type FlatResult = PlaceSearchResult | ItemSearchResult

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { tagName?: string; isContentEditable?: boolean }
  if (el.isContentEditable) return true
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function shouldTriggerQuickSearch(
  event: {
    key: string
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    target: EventTarget | null
  },
  isOpen: boolean,
): 'toggle' | 'open' | null {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
    return 'toggle'
  }
  if (
    !isOpen &&
    event.key === '/' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !isEditableTarget(event.target)
  ) {
    return 'open'
  }
  return null
}

function QuickSearchDialog({
  onClose,
  onNavigate,
  doneIds,
  initialQuery = '',
}: {
  onClose: () => void
  onNavigate: (target: QuickSearchTarget) => void
  doneIds?: readonly string[]
  initialQuery?: string
}) {
  const { locale, t } = useI18n()
  const [query, setQuery] = useState(initialQuery)
  const [activeIndex, setActiveIndex] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const trimmedQuery = query.trim()

  const results = useMemo(() => {
    void t
    if (!trimmedQuery) {
      return {
        places: getQuickBrowsePlaces({ locale, doneIds, maxPlaces: 12 }),
        items: [] as ItemSearchResult[],
      }
    }
    return searchAtlas(trimmedQuery, { locale, doneIds, maxPlaces: 8, maxItems: 24 })
  }, [trimmedQuery, locale, doneIds, t])

  const flatResults = useMemo<FlatResult[]>(
    () => [...results.places, ...results.items],
    [results.places, results.items],
  )

  useEffect(() => {
    setActiveIndex(0)
  }, [trimmedQuery])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    return () => {
      previousFocus?.focus()
    }
  }, [])

  useEffect(() => {
    const activeEl = itemRefs.current[activeIndex]
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  const selectResult = useCallback(
    (entry: FlatResult) => {
      if (entry.kind === 'place') {
        onNavigate({ kind: 'place', slug: entry.slug, placeId: entry.id })
      } else {
        onNavigate({
          kind: 'item',
          placeSlug: entry.placeSlug,
          placeId: entry.placeId,
          itemId: entry.id,
        })
      }
      onClose()
    },
    [onNavigate, onClose],
  )

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        )
        if (focusables.length === 0) return
        const first = focusables[0]!
        const last = focusables[focusables.length - 1]!
        const active = document.activeElement
        if (event.shiftKey) {
          if (active === first || !dialogRef.current.contains(active)) {
            event.preventDefault()
            last.focus()
          }
        } else if (active === last || !dialogRef.current.contains(active)) {
          event.preventDefault()
          first.focus()
        }
        return
      }

      if (flatResults.length === 0) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((prev) => (prev + 1) % flatResults.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((prev) => (prev - 1 + flatResults.length) % flatResults.length)
      } else if (event.key === 'Enter') {
        const activeEl = document.activeElement
        if (activeEl && activeEl !== inputRef.current && activeEl.tagName === 'BUTTON') {
          return
        }
        event.preventDefault()
        const selected = flatResults[activeIndex] ?? flatResults[0]
        if (selected) selectResult(selected)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [flatResults, activeIndex, selectResult, onClose])

  const searchTitle = t('search.title') || 'Quick Search'
  const searchPlaceholder = t('search.placeholder') || 'Search zones, dungeons, collectibles...'
  const searchEmpty = t('search.empty') || 'No matching places or collectibles'
  const placesHeading = t('search.places') || 'Places'
  const collectiblesHeading = t('search.collectibles') || 'Collectibles'

  const placesCount = results.places.length
  itemRefs.current.length = flatResults.length

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-ink-950/80 px-4 pt-[min(12dvh,96px)] pb-4 backdrop-blur-xs"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        data-overlay-open="true"
        aria-labelledby="quick-search-title"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[min(78dvh,600px)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[#e8c04a]/45 bg-ink-900 text-parchment-200 shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-b border-ink-700 px-4 py-3">
          <Search size={17} className="shrink-0 text-[#e8c04a]" aria-hidden />
          <h2 id="quick-search-title" className="sr-only">
            {searchTitle}
          </h2>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchTitle}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm text-parchment-50 placeholder:text-parchment-600 outline-none"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              aria-label={t('common.dismiss')}
              className="grid size-6 shrink-0 cursor-pointer place-items-center rounded text-parchment-400 transition-colors hover:bg-ink-800 hover:text-parchment-50"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border border-ink-700 bg-ink-800/80 text-parchment-200 transition-colors hover:border-parchment-400 hover:bg-ink-700 hover:text-parchment-50"
          >
            <X size={15} />
          </button>
        </div>

        <div className="hyrule-scrollbar flex-1 overflow-y-auto px-2 py-2" role="listbox" aria-label={searchTitle}>
          {flatResults.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-parchment-400">{searchEmpty}</div>
          ) : (
            <div className="space-y-3">
              {results.places.length > 0 && (
                <div>
                  <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-parchment-400 uppercase">
                    {placesHeading}
                  </p>
                  <ul className="space-y-0.5">
                    {results.places.map((place, index) => {
                      const active = index === activeIndex
                      const complete = place.totalCount > 0 && place.doneCount === place.totalCount
                      return (
                        <li key={place.id}>
                          <button
                            ref={(el) => {
                              itemRefs.current[index] = el
                            }}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => selectResult(place)}
                            className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                              active
                                ? 'bg-ink-800 text-parchment-50 ring-1 ring-[#e8c04a]/40'
                                : 'text-parchment-200 hover:bg-ink-800/70'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {place.placeKind === 'dungeon' ? (
                                <Compass size={15} className="shrink-0 text-ember" aria-hidden />
                              ) : (
                                <MapPin size={15} className="shrink-0 text-[#e8c04a]" aria-hidden />
                              )}
                              <span className="truncate font-medium">{place.name}</span>
                              <span className="truncate text-xs text-parchment-400">{place.region}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                              {place.totalCount > 0 && (
                                <span className={complete ? 'text-moss' : 'text-parchment-400'}>
                                  {place.doneCount}/{place.totalCount}
                                </span>
                              )}
                              {active && <CornerDownLeft size={13} className="text-[#e8c04a]" aria-hidden />}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {results.items.length > 0 && (
                <div>
                  <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-parchment-400 uppercase">
                    {collectiblesHeading}
                  </p>
                  <ul className="space-y-0.5">
                    {results.items.map((item, offset) => {
                      const index = placesCount + offset
                      const active = index === activeIndex
                      const { icon: Icon, color } = categoryStyle(item.cat)
                      return (
                        <li key={item.id}>
                          <button
                            ref={(el) => {
                              itemRefs.current[index] = el
                            }}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => selectResult(item)}
                            className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                              active
                                ? 'bg-ink-800 text-parchment-50 ring-1 ring-[#e8c04a]/40'
                                : 'text-parchment-200 hover:bg-ink-800/70'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Icon size={15} style={{ color }} className="shrink-0" aria-hidden />
                              <span className="min-w-0">
                                <span
                                  className={`block truncate font-medium ${
                                    item.done ? 'text-parchment-400 line-through' : ''
                                  }`}
                                >
                                  {item.name}
                                </span>
                                <span className="block truncate text-xs text-parchment-400">
                                  {item.placeName}
                                  {item.floorLabel ? ` · ${item.floorLabel}` : ''} · {item.categoryLabel}
                                </span>
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              {item.done && (
                                <span className="grid size-4 place-items-center rounded bg-moss/20 text-moss">
                                  <Check size={11} strokeWidth={3} aria-hidden />
                                </span>
                              )}
                              {active && <CornerDownLeft size={13} className="text-[#e8c04a]" aria-hidden />}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function QuickSearchModal({
  open,
  onOpen,
  onClose,
  onNavigate,
  doneIds,
  initialQuery,
}: QuickSearchModalProps) {
  useEffect(() => {
    if (typeof window === 'undefined' || !onOpen) return
    function handleGlobalKeyDown(event: KeyboardEvent) {
      const action = shouldTriggerQuickSearch(event, open)
      if (!action) return
      event.preventDefault()
      if (action === 'toggle') {
        if (open) onClose()
        else onOpen?.()
      } else {
        onOpen?.()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [open, onOpen, onClose])

  if (!open) return null
  return (
    <QuickSearchDialog
      onClose={onClose}
      onNavigate={onNavigate}
      doneIds={doneIds}
      initialQuery={initialQuery}
    />
  )
}
