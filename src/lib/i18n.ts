import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { GuideTranslationFile, Locale, LocaleBundle } from './i18n/types'
import type { ItemRequirement } from './types'

export type { GuideItemTranslation, GuidePlaceTranslation, GuideTranslationFile, Locale, LocaleBundle } from './i18n/types'

export const DEFAULT_LOCALE: Locale = 'en'
export const LANG_STORAGE_KEY = 'oot-map:v1:lang'

export type LocaleOption = {
  code: Locale
  label: string
  nativeLabel: string
}

export const LOCALE_OPTIONS: readonly LocaleOption[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'fr', label: 'French', nativeLabel: 'Français' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', nativeLabel: '简体中文' },
  { code: 'zh-TW', label: 'Chinese (Traditional)', nativeLabel: '繁體中文' },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch' },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語' },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어' },
  { code: 'nl', label: 'Dutch', nativeLabel: 'Nederlands' },
  { code: 'ru', label: 'Russian', nativeLabel: 'Русский' },
  { code: 'pl', label: 'Polish', nativeLabel: 'Polski' },
  { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe' },
  { code: 'uk', label: 'Ukrainian', nativeLabel: 'Українська' },
] as const

export const SUPPORTED_LOCALES: readonly Locale[] = LOCALE_OPTIONS.map((option) => option.code)

const VALID_LOCALES = new Set<string>(SUPPORTED_LOCALES)

const BASE_LOCALE_MAP: Record<string, Locale> = {
  en: 'en',
  es: 'es',
  fr: 'fr',
  pt: 'pt',
  de: 'de',
  it: 'it',
  ja: 'ja',
  ko: 'ko',
  nl: 'nl',
  ru: 'ru',
  pl: 'pl',
  tr: 'tr',
  uk: 'uk',
}

/** Maps a BCP-47 language tag (e.g. "zh-Hant-TW", "de-AT") to a supported Locale, or null. */
export function resolveLocaleFromTag(tag: string): Locale | null {
  const normalized = tag.trim().toLowerCase().replace(/_/g, '-')
  if (!normalized) return null

  const parts = normalized.split('-')
  const primary = parts[0]
  if (!primary) return null

  if (primary === 'zh') {
    if (
      parts.includes('hant') ||
      parts.includes('tw') ||
      parts.includes('hk') ||
      parts.includes('mo')
    ) {
      return 'zh-TW'
    }
    return 'zh-CN'
  }

  return BASE_LOCALE_MAP[primary] ?? null
}

function detectNavigatorLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE
  const candidates: string[] = []
  if (Array.isArray(navigator.languages)) {
    for (const lang of navigator.languages) {
      if (typeof lang === 'string') candidates.push(lang)
    }
  }
  if (typeof navigator.language === 'string') {
    candidates.push(navigator.language)
  }
  for (const tag of candidates) {
    const resolved = resolveLocaleFromTag(tag)
    if (resolved) return resolved
  }
  return DEFAULT_LOCALE
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && VALID_LOCALES.has(value)
}

const EN_MESSAGES = {
  'app.title': 'Ocarina Atlas',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.undo': 'Undo',
  'common.dismiss': 'Dismiss',
  'common.retry': 'Retry',
  'common.rename': 'Rename',
  'common.delete': 'Delete',
  'common.on': 'On',
  'common.off': 'Off',
  'common.or': 'or',
  'common.link': 'Link',
  'common.saved': 'Saved',
  'common.live': 'Live',
  'common.language': 'Language',

  'notFound.title': 'Uncharted ground',
  'notFound.description': 'No place on the atlas matches this address.',
  'notFound.backToMap': 'Back to the map',

  'map.dragHint': '{alt}. Drag to pan, scroll to zoom, or use the arrow, plus and minus keys.',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.resetView': 'Reset view',
  'map.enterFullscreen': 'Enter fullscreen map',
  'map.fullscreenMap': 'Fullscreen map',
  'map.fullscreen': 'Fullscreen',
  'map.exitFullscreen': 'Exit fullscreen',
  'map.exitFullscreenAria': 'Exit fullscreen map',
  'map.worldMap': 'World Map',

  'world.mapAlt': 'Map of Hyrule',
  'world.stats': 'Stats',
  'world.openStats': 'Open global progress stats',
  'world.globalCompletion': 'Global completion',
  'world.zone': 'Zone',
  'world.dungeon': 'Dungeon',
  'world.noTrackedItems': 'No tracked items',
  'world.itemsCompleted': '{done} / {total} items completed',
  'world.itemsCompletedOf': '{done} of {total} items completed',
  'world.placeDetails': '{name} details',
  'world.closePlaceInfo': 'Close place info',
  'world.linkHereLive': 'Link is here (Live)',
  'world.linkHereSaved': 'Link is here (Saved)',
  'world.openMap': 'Open map',

  'stats.title': 'Global Progress',
  'stats.subtitle': 'Hyrule completion across all zones and dungeons',
  'stats.close': 'Close global progress',
  'stats.placesCompleted': '{done} / {total} places completed',
  'stats.overallCompletion': 'Overall completion',
  'stats.byCategory': 'By Category',
  'stats.clickAgainToClear': 'Click again to clear',
  'stats.selectToViewItems': 'Select to view items',
  'stats.remainingCount': '({count} remaining)',
  'stats.filterCategoryItems': 'Filter category items',
  'stats.remaining': 'Remaining',
  'stats.all': 'All',
  'stats.closeCategoryItems': 'Close {category} items',
  'stats.allCollected': 'All {category} collected!',
  'stats.noItemsInCategory': 'No items in this category.',
  'stats.collected': 'Collected',
  'stats.byLocation': 'By Location',
  'stats.placeSingular': 'place',
  'stats.placePlural': 'places',
  'stats.filterLocations': 'Filter locations',
  'stats.tabAll': 'All',
  'stats.tabIncomplete': 'Incomplete',
  'stats.tabZones': 'Zones',
  'stats.tabDungeons': 'Dungeons',
  'stats.allLocationsComplete': 'All locations are 100% complete!',
  'stats.noLocationsMatch': 'No locations match this filter.',

  'place.atlas': 'Atlas',
  'place.inRegion': '{kind} in {region}',
  'place.itemsCount': '{done}/{total} items',
  'place.hideCount': 'Hide',
  'place.showItemCount': 'Show item count',
  'place.about': 'About this place',
  'place.chooseMap': 'Choose a map',
  'place.allFloors': 'All floors',
  'place.allFloorsAlt': 'All floors of {place}',
  'place.mapAlt': 'Map of {place}, {floor}',
  'place.linkOnFloor': 'Link is on this floor',
  'place.linkOnFloorSaved': 'Link is on this floor (Saved)',
  'place.yourPins': 'Your pins',
  'place.yourPinsFloor': 'Your pins · {floor}',
  'place.clickFloorToAdd': 'Click any floor to add a pin.',
  'place.clickMapToAdd': 'Click the map to add a pin.',
  'place.officialPins': 'Official pins',
  'place.noMapTitle': 'No map for this place',
  'place.noMapWithItems': 'Show official pins to track its items from the list. Custom pins need a map.',
  'place.noMapEmpty': 'There are no tracked items here either. Custom pins need a map.',
  'place.maplessOfficialHiddenHint': 'Official pins are hidden. Turn them on to browse tracked items in this place.',

  'panel.showOfficialPins': 'Show official pins',
  'panel.filterByAge': 'Filter by age',
  'panel.filterByCategory': 'Filter by category',
  'panel.ageChild': 'Child',
  'panel.ageAdult': 'Adult',
  'panel.ageBoth': 'Both',
  'panel.ageChildOrAdult': 'Child or adult',
  'panel.notOnMap': 'Not on a map',
  'panel.nothingToShow': 'Nothing to show on this map.',
  'panel.markCompleted': 'Mark completed',
  'panel.completed': 'Completed',
  'panel.markItemCompleted': 'Mark {name} completed',
  'panel.hideAgain': 'Hide again',
  'panel.type': 'Type',
  'panel.renameItem': 'Rename {name}',
  'panel.deleteItem': 'Delete {name}',
  'panel.closePinInfo': 'Close pin info',
  'panel.yourPin': 'your pin',

  'item.nightOnly': 'Night only',
  'item.hint': 'Hint',
  'item.requires': 'Requires',
  'item.imageAlt': '{name}, image {index}',

  'pin.whatDidYouFind': 'What did you find?',
  'pin.pinName': 'Pin name',
  'pin.addPin': 'Add pin',
  'pin.type.gs': 'Gold Skulltula',
  'pin.type.heart': 'Piece of Heart',
  'pin.type.container': 'Heart Container',
  'pin.type.bean': 'Magic Bean soil',
  'pin.type.fairy': 'Great Fairy',
  'pin.type.bottle': 'Bottle',
  'pin.type.key': 'Key',
  'pin.type.thought': 'Fairy Thought',
  'pin.type.other': 'Other',

  'merge.mergedTitle': 'Merged with official pin',
  'merge.existsTitle': 'This one already exists',
  'merge.description': 'Your pin was close enough, so the official one replaces it.',

  'tracker.live': 'Live',
  'tracker.waitingForGame': 'Waiting for game',
  'tracker.waitingNote': 'RPC connected; showing save data until in-game',
  'tracker.saveOnly': 'Save only',
  'tracker.offlineNote': 'Offline ({emulator} RPC :6545 closed)',
  'tracker.disconnected': 'Disconnected',
  'tracker.emulatorTracker': '{emulator} emulator tracker',
  'tracker.collapsePanel': 'Collapse tracker panel',
  'tracker.skulltulasTitle': 'Gold Skulltulas collected in this save',
  'tracker.errorPrefix': 'Error: {error}',
  'tracker.goToLink': 'Go to Link',
  'tracker.followLink': 'Follow Link: {state}',
  'tracker.autoTracking': 'Auto Tracking: {state}',
  'tracker.autoTrackingTitle':
    'Automatically track collected Skulltulas, Heart Containers, Heart Pieces, Magic Beans, Great Fairies, Bottles, and Fairy Thoughts',
  'tracker.skulltulaCollected': 'Gold Skulltula collected!',
  'tracker.dismissNotification': 'Dismiss notification',
  'tracker.ariaSkulltulas': '{count} of 100 Gold Skulltulas',
  'tracker.ariaSkulltulasUnavailable': 'Gold Skulltula count unavailable',
  'tracker.ariaLocation': 'Location: {location}',
  'tracker.saveSlot': 'Save Slot',
  'tracker.saveSlotAuto': 'Auto',
  'tracker.nearestPin': 'Nearest item',
  'tracker.nearestPinTitle': 'Show nearest reachable collectible emerging from the orb when nearby',
  'tracker.nearestDistance': '{distance}m',
  'player.ariaAtCoords': '{label} at X {x}, Y {y}, Z {z}',

  'floor.child': 'Child',
  'floor.adult': 'Adult',
  'floor.main': 'Main',

  'filter.hideCompleted': 'Hide completed',
  'filter.prereqOnly': 'Only reachable',
  'filter.gearButton': 'My Gear',
  'filter.gearTitle': 'Owned Gear & Songs',
  'filter.gearSubtitle': 'Check the items, upgrades, and songs you have to filter reachable collectibles.',
  'filter.syncFromGame': 'Sync from game',
  'filter.autoSync': 'Auto-sync gear',
  'filter.clearAll': 'Clear all',
  'filter.group.tools': 'Tools & Weapons',
  'filter.group.gear': 'Gear & Upgrades',
  'filter.group.songs': 'Songs',
  'filter.group.situational': 'Situational',
  'filter.reachableCount': '{count} reachable',
  'filter.prereqNotice': 'Filtered by your owned prerequisites',
  'filter.missingReqs': 'Missing prerequisites',

  'credits.title': 'Credits & About',
  'credits.button': 'Credits',
  'credits.originalMap': 'Original Interactive Map',
  'credits.originalMapDesc': 'Created by lucasriondel (oot-remake-map)',
  'credits.atlasAuthor': 'Ocarina Atlas',
  'credits.atlasAuthorDesc': 'Live telemetry, desktop launcher, and auto-tracking by antonioalvromero',
  'credits.mapArtwork': 'Map artwork and collectible data originally attributed to Nintendúo (non-commercial fan project, not affiliated with Nintendo).',
  'credits.officialGithub': 'Official GitHub Repository',
  'credits.officialNotice': 'Free & open-source (GNU AGPL-3.0). Official releases: github.com/antonioalvromero/Ocarina-Atlas — forks must preserve credits and share source.',
  'credits.close': 'Close',

  'search.open': 'Search',
  'search.title': 'Quick search',
  'search.placeholder': 'Search places or collectibles...',
  'search.empty': 'No matching places or collectibles.',
  'search.places': 'Places',
  'search.collectibles': 'Collectibles',
  'search.copyLink': 'Copy link',
  'search.linkCopied': 'Link copied!',

  'filter.spoilerFree': 'Spoiler shield (hints first)',
  'filter.spoilerFreeShort': 'No spoilers',
  'preset.discovery': 'Discovery mode',
  'preset.fullAtlas': '100% Atlas mode',
  'spoiler.hiddenNotice': 'Full walkthrough and screenshots are hidden to avoid spoilers.',
  'spoiler.revealSolution': 'Reveal full solution',
  'spoiler.hideSolution': 'Hide solution',

  'backup.title': 'Backup & Profiles',
  'backup.export': 'Export JSON',
  'backup.import': 'Import JSON',
  'backup.exported': 'Backup exported!',
  'backup.imported': 'Backup imported!',
  'backup.invalid': 'Invalid backup file.',
  'backup.activeProfile': 'Save profile: {profile}',
} as const

export type TranslationKey = keyof typeof EN_MESSAGES
export type I18nKey = TranslationKey

const EN_CATEGORY_LABELS: Record<string, string> = {
  gs: 'Gold Skulltulas',
  heart: 'Pieces of Heart',
  container: 'Heart Containers',
  bean: 'Magic Beans',
  fairy: 'Great Fairies',
  bottle: 'Bottles',
  thought: 'Fairy Thoughts',
}

const EN_PLACE_LABELS: Record<string, string> = {
  kokiri: 'Kokiri Forest',
  perdido: 'Lost Woods',
  prado: 'Sacred Forest Meadow',
  llanura: 'Hyrule Field',
  lonlon: 'Lon Lon Ranch',
  ciudadela: 'Hyrule Castle Town',
  castillo: 'Hyrule Castle',
  kakariko: 'Kakariko Village',
  cementerio: 'Graveyard',
  sendero: 'Death Mountain Trail',
  goron: 'Goron City',
  crater: 'Death Mountain Crater',
  rio: "Zora's River",
  dominio: "Zora's Domain",
  fuente: "Zora's Fountain",
  lago: 'Lake Hylia',
  valle: 'Gerudo Valley',
  fortaleza: "Gerudo's Fortress",
  desierto: 'Haunted Wasteland',
  coloso: 'Desert Colossus',
  deku: 'Inside the Deku Tree',
  dodongos: "Dodongo's Cavern",
  jabu: "Inside Jabu-Jabu's Belly",
  bosque: 'Forest Temple',
  fuego: 'Fire Temple',
  agua: 'Water Temple',
  sombra: 'Shadow Temple',
  espiritu: 'Spirit Temple',
  pozo: 'Bottom of the Well',
  hielo: 'Ice Cavern',
  gerudo: 'Gerudo Training Ground',
  ganon: "Ganon's Castle",
}

const EN_REGION_LABELS: Record<string, string> = {
  Forest: 'Forest',
  'Central Hyrule': 'Central Hyrule',
  Castle: 'Castle',
  Kakariko: 'Kakariko',
  'Death Mountain': 'Death Mountain',
  Zora: 'Zora',
  'Lake Hylia': 'Lake Hylia',
  Gerudo: 'Gerudo',
}

const EN_REQUIREMENT_LABELS: Record<string, string> = {
  bugs: 'Bottled Bug',
  bombs: 'Bombs',
  boomerang: 'Boomerang',
  slingshot: 'Fairy Slingshot',
  bow: 'Fairy Bow',
  hookshot: 'Hookshot',
  longshot: 'Longshot',
  'megaton-hammer': 'Megaton Hammer',
  'iron-boots': 'Iron Boots',
  'golden-scale': 'Golden Scale',
  'silver-gauntlets': 'Silver Gauntlets',
  'lens-of-truth': 'Lenses of Truth',
  ocarina: 'Ocarina',
  'sarias-song': "Saria's Song",
  'song-of-storms': 'Song of Storms',
  epona: 'Epona',
  'planted-bean': 'Planted Magic Bean',
  bombchus: 'Bombchus',
  'fire-arrows': 'Fire Arrows',
  'hover-boots': 'Hover Boots',
  'silver-scale': 'Silver Scale',
  'goron-bracelet': "Goron's Bracelet",
  'golden-gauntlets': 'Golden Gauntlets',
  'mirror-shield': 'Mirror Shield',
  'zora-tunic': 'Zora Tunic',
  'deku-sticks': 'Deku Sticks',
  'dins-fire': "Din's Fire",
  'blue-fire': 'Blue Fire',
  'zeldas-lullaby': "Zelda's Lullaby",
  'eponas-song': "Epona's Song",
  'suns-song': "Sun's Song",
  'song-of-time': 'Song of Time',
  'scarecrows-song': "Scarecrow's Song",
  'bolero-of-fire': 'Bolero of Fire',
  'gerudo-card': 'Gerudo Token',
}

export const MESSAGES: Partial<Record<Locale, Record<TranslationKey, string>>> & {
  en: Record<TranslationKey, string>
} = {
  en: EN_MESSAGES,
}

export const CATEGORY_LABELS: Partial<Record<Locale, Record<string, string>>> & {
  en: Record<string, string>
} = {
  en: EN_CATEGORY_LABELS,
}

export const PLACE_LABELS: Partial<Record<Locale, Record<string, string>>> & {
  en: Record<string, string>
} = {
  en: EN_PLACE_LABELS,
}

export const REGION_LABELS: Partial<Record<Locale, Record<string, string>>> & {
  en: Record<string, string>
} = {
  en: EN_REGION_LABELS,
}

export const REQUIREMENT_LABELS: Partial<Record<Locale, Record<string, string>>> & {
  en: Record<string, string>
} = {
  en: EN_REQUIREMENT_LABELS,
}

const GUIDE_TRANSLATIONS: Partial<Record<Locale, GuideTranslationFile>> = {}

type LazyLocale = Exclude<Locale, 'en'>
type LocaleModule = {
  loadLocale: () => Promise<LocaleBundle<TranslationKey>>
}

const LOCALE_LOADERS: Record<LazyLocale, () => Promise<LocaleModule>> = {
  es: () => import('./i18n/locales/es'),
  fr: () => import('./i18n/locales/fr'),
  pt: () => import('./i18n/locales/pt'),
  'zh-CN': () => import('./i18n/locales/zh-CN'),
  'zh-TW': () => import('./i18n/locales/zh-TW'),
  de: () => import('./i18n/locales/de'),
  it: () => import('./i18n/locales/it'),
  ja: () => import('./i18n/locales/ja'),
  ko: () => import('./i18n/locales/ko'),
  nl: () => import('./i18n/locales/nl'),
  ru: () => import('./i18n/locales/ru'),
  pl: () => import('./i18n/locales/pl'),
  tr: () => import('./i18n/locales/tr'),
  uk: () => import('./i18n/locales/uk'),
}

const loadedLocales = new Set<Locale>([DEFAULT_LOCALE])
const pendingLoads = new Map<Locale, Promise<void>>()
let bundleRevision = 0

const listeners = new Set<() => void>()

function emitChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function isLocaleLoaded(locale: Locale): boolean {
  return locale === DEFAULT_LOCALE || loadedLocales.has(locale)
}

/**
 * Dynamically loads a non-English locale dictionary (and guide translations for es/fr/pt).
 * Safe to call repeatedly; concurrent calls for the same locale share one in-flight promise.
 */
export function preloadLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale) || locale === 'en' || loadedLocales.has(locale)) {
    return Promise.resolve()
  }

  const lazyLocale: LazyLocale = locale
  const existing = pendingLoads.get(lazyLocale)
  if (existing) return existing

  const loader = LOCALE_LOADERS[lazyLocale]
  const promise = loader()
    .then((mod) => mod.loadLocale())
    .then((bundle) => {
      MESSAGES[lazyLocale] = bundle.messages
      CATEGORY_LABELS[lazyLocale] = bundle.categories
      PLACE_LABELS[lazyLocale] = bundle.places
      REGION_LABELS[lazyLocale] = bundle.regions
      REQUIREMENT_LABELS[lazyLocale] = bundle.requirements
      if (bundle.guides) {
        GUIDE_TRANSLATIONS[lazyLocale] = bundle.guides
      }
      loadedLocales.add(lazyLocale)
      pendingLoads.delete(lazyLocale)
      bundleRevision += 1
      emitChange()
    })
    .catch((err: unknown) => {
      pendingLoads.delete(lazyLocale)
      throw err
    })

  pendingLoads.set(lazyLocale, promise)
  return promise
}

function ensureLocaleRequested(locale: Locale): void {
  if (locale !== DEFAULT_LOCALE && !loadedLocales.has(locale)) {
    void preloadLocale(locale).catch(() => {
      // Keep English fallback if a lazy locale chunk fails to load.
    })
  }
}

/**
 * Reads the persisted locale from localStorage, falling back to navigator.language
 * when unset/invalid on the client, or 'en' on SSR.
 */
export function getLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  try {
    const raw = window.localStorage.getItem(LANG_STORAGE_KEY)
    if (isLocale(raw)) return raw
  } catch {
    // Ignore storage access errors in restricted environments.
  }
  return detectNavigatorLocale()
}

function getStoreSnapshot(): string {
  return `${getLocale()}:${bundleRevision}`
}

function getServerStoreSnapshot(): string {
  return `${DEFAULT_LOCALE}:0`
}

/** Persists the selected locale to localStorage, starts loading its bundle, and notifies subscribers. */
export function setLocale(next: Locale): void {
  if (!isLocale(next)) return
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next)
    } catch {
      // Ignore storage quota or security errors in restricted environments.
    }
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = next
  }
  ensureLocaleRequested(next)
  emitChange()
}

function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener)

  // Trigger lazy-loading on client mount when persisted/detected locale is non-English.
  ensureLocaleRequested(getLocale())

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LANG_STORAGE_KEY) {
      ensureLocaleRequested(getLocale())
      listener()
    }
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', onStorage)
  }

  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('storage', onStorage)
    }
  }
}

export type TranslationParams = Record<string, string | number>

export function formatMessage(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key]
    return value === undefined ? match : String(value)
  })
}

export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const dict = MESSAGES[locale] ?? MESSAGES.en
  const template = dict[key] ?? MESSAGES.en[key]
  return formatMessage(template, params)
}

export function translateCategory(locale: Locale, key: string, fallback?: string): string {
  return CATEGORY_LABELS[locale]?.[key] ?? CATEGORY_LABELS.en[key] ?? fallback ?? key
}

export function translatePlace(locale: Locale, id: string, fallback?: string): string {
  return PLACE_LABELS[locale]?.[id] ?? PLACE_LABELS.en[id] ?? fallback ?? id
}

export function translateRegion(locale: Locale, region: string): string {
  return REGION_LABELS[locale]?.[region] ?? REGION_LABELS.en[region] ?? region
}

export function translateRequirement(locale: Locale, requirement: ItemRequirement): string {
  const keys = typeof requirement === 'string' ? [requirement] : requirement
  const labels = REQUIREMENT_LABELS[locale] ?? REQUIREMENT_LABELS.en
  const joiner = ` ${translate(locale, 'common.or')} `
  return keys.map((key) => labels[key] ?? REQUIREMENT_LABELS.en[key] ?? key).join(joiner)
}

export function translatePlaceIntro(placeId: string, fallback: string, locale: Locale): string {
  const translated = GUIDE_TRANSLATIONS[locale]?.places?.[placeId]?.intro
  return translated && translated.length > 0 ? translated : fallback
}

export function translateItemName(itemId: string, fallback: string, locale: Locale): string {
  const translated = GUIDE_TRANSLATIONS[locale]?.items?.[itemId]?.name
  return translated && translated.length > 0 ? translated : fallback
}

export function translateItemDesc(itemId: string, fallback: string, locale: Locale): string {
  const translated = GUIDE_TRANSLATIONS[locale]?.items?.[itemId]?.desc
  return translated && translated.length > 0 ? translated : fallback
}

export function translateItemHint(itemId: string, fallback: string, locale: Locale): string {
  const translated = GUIDE_TRANSLATIONS[locale]?.items?.[itemId]?.hint
  return translated && translated.length > 0 ? translated : fallback
}

export type I18nApi = {
  locale: Locale
  setLocale: (next: Locale) => void
  t: (key: TranslationKey, params?: TranslationParams) => string
  tCategory: (key: string, fallback?: string) => string
  tPlace: (id: string, fallback?: string) => string
  tRegion: (region: string) => string
  tRequirement: (requirement: ItemRequirement) => string
  tPlaceIntro: (placeId: string, fallback: string) => string
  tItemName: (itemId: string, fallback: string) => string
  tItemDesc: (itemId: string, fallback: string) => string
  tItemHint: (itemId: string, fallback: string) => string
}

/**
 * React hook subscribing to the active locale via useSyncExternalStore.
 * Server snapshot always returns 'en' for SSR hydration safety.
 */
export function useI18n(): I18nApi {
  const snapshot = useSyncExternalStore(subscribeLocale, getStoreSnapshot, getServerStoreSnapshot)
  const sepIndex = snapshot.indexOf(':')
  const locale = (sepIndex === -1 ? snapshot : snapshot.slice(0, sepIndex)) as Locale
  const revision = sepIndex === -1 ? '0' : snapshot.slice(sepIndex + 1)

  useEffect(() => {
    ensureLocaleRequested(locale)
  }, [locale])

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(locale, key, params),
    [locale, revision],
  )
  const tCategory = useCallback(
    (key: string, fallback?: string) => translateCategory(locale, key, fallback),
    [locale, revision],
  )
  const tPlace = useCallback(
    (id: string, fallback?: string) => translatePlace(locale, id, fallback),
    [locale, revision],
  )
  const tRegion = useCallback(
    (region: string) => translateRegion(locale, region),
    [locale, revision],
  )
  const tRequirement = useCallback(
    (requirement: ItemRequirement) => translateRequirement(locale, requirement),
    [locale, revision],
  )
  const tPlaceIntro = useCallback(
    (placeId: string, fallback: string) => translatePlaceIntro(placeId, fallback, locale),
    [locale, revision],
  )
  const tItemName = useCallback(
    (itemId: string, fallback: string) => translateItemName(itemId, fallback, locale),
    [locale, revision],
  )
  const tItemDesc = useCallback(
    (itemId: string, fallback: string) => translateItemDesc(itemId, fallback, locale),
    [locale, revision],
  )
  const tItemHint = useCallback(
    (itemId: string, fallback: string) => translateItemHint(itemId, fallback, locale),
    [locale, revision],
  )

  return useMemo(
    () => ({
      locale,
      setLocale,
      t,
      tCategory,
      tPlace,
      tRegion,
      tRequirement,
      tPlaceIntro,
      tItemName,
      tItemDesc,
      tItemHint,
    }),
    [locale, revision, t, tCategory, tPlace, tRegion, tRequirement, tPlaceIntro, tItemName, tItemDesc, tItemHint],
  )
}
