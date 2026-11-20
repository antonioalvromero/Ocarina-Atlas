import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dataset } from './data'
import {
  CATEGORY_LABELS,
  DEFAULT_LOCALE,
  LANG_STORAGE_KEY,
  LOCALE_OPTIONS,
  MESSAGES,
  PLACE_LABELS,
  REGION_LABELS,
  REQUIREMENT_LABELS,
  SUPPORTED_LOCALES,
  getLocale,
  isLocaleLoaded,
  preloadLocale,
  resolveLocaleFromTag,
  setLocale,
  translate,
  translateCategory,
  translateItemDesc,
  translateItemHint,
  translateItemName,
  translatePlace,
  translatePlaceIntro,
  translateRegion,
  translateRequirement,
  useI18n,
  type I18nKey,
  type Locale,
  type TranslationKey,
} from './i18n'

const ALL_LOCALES: Locale[] = [
  'en',
  'es',
  'fr',
  'pt',
  'zh-CN',
  'zh-TW',
  'de',
  'it',
  'ja',
  'ko',
  'nl',
  'ru',
  'pl',
  'tr',
  'uk',
]

function fakeWindow(initialEntries: Record<string, string> = {}) {
  const entries = new Map<string, string>(Object.entries(initialEntries))
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    localStorage: {
      get length() {
        return entries.size
      },
      key: (index: number) => Array.from(entries.keys())[index] ?? null,
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value)
      },
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('i18n', () => {
  it('defaults to English ("en") when window or localStorage is absent', () => {
    vi.stubGlobal('window', undefined)
    expect(DEFAULT_LOCALE).toBe('en')
    expect(getLocale()).toBe('en')

    vi.stubGlobal('window', fakeWindow())
    expect(getLocale()).toBe('en')
  })

  it('exposes all 15 supported locales in LOCALE_OPTIONS and SUPPORTED_LOCALES', () => {
    expect(LOCALE_OPTIONS.map((o) => o.code)).toEqual(ALL_LOCALES)
    expect(SUPPORTED_LOCALES).toEqual(ALL_LOCALES)
  })

  it('loads only English synchronously and falls back to English until a locale is preloaded', async () => {
    expect(isLocaleLoaded('en')).toBe(true)
    expect(isLocaleLoaded('es')).toBe(false)
    expect(translate('es', 'world.mapAlt')).toBe('Map of Hyrule')
    expect(translatePlace('es', 'espiritu')).toBe('Spirit Temple')

    await preloadLocale('es')
    expect(isLocaleLoaded('es')).toBe(true)
    expect(translate('es', 'world.mapAlt')).toBe('Mapa de Hyrule')
    expect(translatePlace('es', 'espiritu')).toBe('Templo del Espíritu')
  })

  it('resolves BCP-47 language tags to supported locales', () => {
    expect(resolveLocaleFromTag('zh-CN')).toBe('zh-CN')
    expect(resolveLocaleFromTag('zh-Hans')).toBe('zh-CN')
    expect(resolveLocaleFromTag('zh-Hans-CN')).toBe('zh-CN')
    expect(resolveLocaleFromTag('zh-SG')).toBe('zh-CN')
    expect(resolveLocaleFromTag('zh')).toBe('zh-CN')

    expect(resolveLocaleFromTag('zh-TW')).toBe('zh-TW')
    expect(resolveLocaleFromTag('zh-Hant')).toBe('zh-TW')
    expect(resolveLocaleFromTag('zh-Hant-TW')).toBe('zh-TW')
    expect(resolveLocaleFromTag('zh-HK')).toBe('zh-TW')
    expect(resolveLocaleFromTag('zh-MO')).toBe('zh-TW')

    expect(resolveLocaleFromTag('de-AT')).toBe('de')
    expect(resolveLocaleFromTag('it-IT')).toBe('it')
    expect(resolveLocaleFromTag('ja-JP')).toBe('ja')
    expect(resolveLocaleFromTag('ko-KR')).toBe('ko')
    expect(resolveLocaleFromTag('nl-BE')).toBe('nl')
    expect(resolveLocaleFromTag('ru-RU')).toBe('ru')
    expect(resolveLocaleFromTag('pl-PL')).toBe('pl')
    expect(resolveLocaleFromTag('tr-TR')).toBe('tr')
    expect(resolveLocaleFromTag('uk-UA')).toBe('uk')

    expect(resolveLocaleFromTag('xx-YY')).toBeNull()
    expect(resolveLocaleFromTag('')).toBeNull()
  })

  it('auto-detects navigator.language when localStorage has no saved locale', () => {
    vi.stubGlobal('window', fakeWindow())
    vi.stubGlobal('navigator', { language: 'zh-Hant-HK', languages: ['zh-Hant-HK', 'en-US'] })
    expect(getLocale()).toBe('zh-TW')

    vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE'] })
    expect(getLocale()).toBe('de')

    // Saved localStorage preference overrides navigator.language
    vi.stubGlobal('window', fakeWindow({ [LANG_STORAGE_KEY]: 'ja' }))
    expect(getLocale()).toBe('ja')

    // Unsupported navigator language falls back to en
    vi.stubGlobal('window', fakeWindow())
    vi.stubGlobal('navigator', { language: 'sv-SE', languages: ['sv-SE'] })
    expect(getLocale()).toBe('en')
  })

  it('persists locale changes to localStorage under oot-map:v1:lang', () => {
    const win = fakeWindow()
    vi.stubGlobal('window', win)

    for (const locale of ALL_LOCALES) {
      setLocale(locale)
      expect(win.localStorage.getItem(LANG_STORAGE_KEY)).toBe(locale)
      expect(getLocale()).toBe(locale)
    }
  })

  it('ignores invalid persisted or requested locales and falls back to en', () => {
    const win = fakeWindow({ [LANG_STORAGE_KEY]: 'xx' })
    vi.stubGlobal('window', win)
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] })

    expect(getLocale()).toBe('en')
    setLocale('invalid' as Locale)
    expect(win.localStorage.getItem(LANG_STORAGE_KEY)).toBe('xx')
    expect(getLocale()).toBe('en')
  })

  it('uses English on SSR via useSyncExternalStore server snapshot', () => {
    vi.stubGlobal('window', undefined)

    function Probe() {
      const { locale, t, tCategory, tPlace, tRegion, tRequirement } = useI18n()
      return createElement(
        'div',
        null,
        `${locale}|${t('world.mapAlt')}|${tCategory('gs')}|${tPlace('kokiri')}|${tRegion('Forest')}|${tRequirement(['bombs', 'megaton-hammer'])}`,
      )
    }

    const html = renderToString(createElement(Probe))
    expect(html).toContain('en|Map of Hyrule|Gold Skulltulas|Kokiri Forest|Forest|Bombs or Megaton Hammer')
  })

  it('interpolates parameters in translated strings', async () => {
    await Promise.all([preloadLocale('es'), preloadLocale('fr'), preloadLocale('pt')])

    expect(translate('en', 'world.itemsCompleted', { done: 3, total: 10 })).toBe('3 / 10 items completed')
    expect(translate('es', 'world.itemsCompleted', { done: 3, total: 10 })).toBe('3 / 10 objetos completados')
    expect(translate('fr', 'world.itemsCompleted', { done: 3, total: 10 })).toBe('3 / 10 objets complétés')
    expect(translate('pt', 'world.itemsCompleted', { done: 3, total: 10 })).toBe('3 / 10 itens concluídos')

    expect(translate('en', 'filter.reachableCount', { count: 12 })).toBe('12 reachable')
    expect(translate('es', 'filter.reachableCount', { count: 12 })).toBe('12 alcanzables')
    expect(translate('fr', 'filter.reachableCount', { count: 12 })).toBe('12 accessibles')
    expect(translate('pt', 'filter.reachableCount', { count: 12 })).toBe('12 alcançáveis')
  })

  it('translates categories, places, regions, and requirements across all locales', async () => {
    await Promise.all([preloadLocale('es'), preloadLocale('fr'), preloadLocale('pt')])

    expect(translateCategory('es', 'gs')).toBe('Skulltulas Doradas')
    expect(translateCategory('fr', 'heart')).toBe('Quarts de Cœur')
    expect(translateCategory('pt', 'fairy')).toBe('Grandes Fadas')
    expect(translateCategory('en', 'unknown', 'Fallback')).toBe('Fallback')

    expect(translatePlace('es', 'espiritu')).toBe('Templo del Espíritu')
    expect(translatePlace('fr', 'kakariko')).toBe('Village Cocorico')
    expect(translatePlace('pt', 'llanura')).toBe('Campos de Hyrule')
    expect(translatePlace('en', 'unknown', 'Unknown Place')).toBe('Unknown Place')

    expect(translateRegion('es', 'Death Mountain')).toBe('Montaña de la Muerte')
    expect(translateRegion('fr', 'Lake Hylia')).toBe('Lac Hylia')
    expect(translateRegion('pt', 'Forest')).toBe('Floresta')

    expect(translateRequirement('es', 'bombs')).toBe('Bombas')
    expect(translateRequirement('es', ['bombs', 'megaton-hammer'])).toBe('Bombas o Martillo Megatón')
    expect(translateRequirement('fr', ['hookshot', 'longshot'])).toBe('Grappin ou Super Grappin')
    expect(translateRequirement('pt', ['bombs', 'hover-boots'])).toBe('Bombas ou Botas Flutuantes')
  })

  it('has complete, non-empty UI message translations with matching placeholders for all 15 locales', async () => {
    await Promise.all(ALL_LOCALES.map((locale) => preloadLocale(locale)))

    const enKeys = Object.keys(MESSAGES.en) as TranslationKey[]
    const searchKeys: I18nKey[] = [
      'search.open',
      'search.title',
      'search.placeholder',
      'search.empty',
      'search.places',
      'search.collectibles',
      'search.copyLink',
      'search.linkCopied',
      'backup.title',
      'backup.export',
      'backup.import',
      'backup.exported',
      'backup.imported',
      'backup.invalid',
      'backup.activeProfile',
    ]
    for (const key of searchKeys) {
      expect(enKeys).toContain(key)
    }

    const extractPlaceholders = (text: string) =>
      Array.from(text.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort()

    for (const locale of ALL_LOCALES) {
      const dict = MESSAGES[locale]
      expect(dict, `Locale "${locale}" should be loaded`).toBeDefined()
      if (!dict) continue
      expect(Object.keys(dict).sort()).toEqual([...enKeys].sort())
      for (const key of enKeys) {
        expect(dict[key], `Missing or empty key "${key}" in locale "${locale}"`).toBeTruthy()
        expect(
          extractPlaceholders(dict[key]),
          `Placeholder mismatch for key "${key}" in locale "${locale}"`,
        ).toEqual(extractPlaceholders(MESSAGES.en[key]))
      }
    }
  })

  it('covers every category, place, region, and requirement in oot.json for all 15 locales', async () => {
    await Promise.all(ALL_LOCALES.map((locale) => preloadLocale(locale)))
    const uniqueRegions = Array.from(new Set(dataset.places.map((p) => p.region)))

    for (const locale of ALL_LOCALES) {
      for (const category of dataset.categories) {
        expect(
          CATEGORY_LABELS[locale]?.[category.key],
          `Missing category "${category.key}" for "${locale}"`,
        ).toBeTruthy()
      }

      for (const place of dataset.places) {
        expect(
          PLACE_LABELS[locale]?.[place.id],
          `Missing place "${place.id}" for "${locale}"`,
        ).toBeTruthy()
      }

      for (const region of uniqueRegions) {
        expect(
          REGION_LABELS[locale]?.[region],
          `Missing region "${region}" for "${locale}"`,
        ).toBeTruthy()
      }

      for (const req of dataset.requirements) {
        expect(
          REQUIREMENT_LABELS[locale]?.[req.key],
          `Missing requirement "${req.key}" for "${locale}"`,
        ).toBeTruthy()
      }
    }
  })

  it('covers every place intro and every item name, desc, and non-null hint in es, fr, and pt', async () => {
    const locales: Locale[] = ['es', 'fr', 'pt']
    await Promise.all(locales.map((locale) => preloadLocale(locale)))

    expect(dataset.places).toHaveLength(32)
    expect(dataset.items).toHaveLength(184)

    for (const locale of locales) {
      for (const place of dataset.places) {
        const translatedIntro = translatePlaceIntro(place.id, '', locale)
        expect(
          translatedIntro.trim().length,
          `Missing or empty intro for place "${place.id}" in "${locale}"`,
        ).toBeGreaterThan(0)
      }

      for (const item of dataset.items) {
        const translatedName = translateItemName(item.id, '', locale)
        expect(
          translatedName.trim().length,
          `Missing or empty name for item "${item.id}" in "${locale}"`,
        ).toBeGreaterThan(0)

        const translatedDesc = translateItemDesc(item.id, '', locale)
        expect(
          translatedDesc.trim().length,
          `Missing or empty desc for item "${item.id}" in "${locale}"`,
        ).toBeGreaterThan(0)

        if (item.hint !== null) {
          const translatedHint = translateItemHint(item.id, '', locale)
          expect(
            translatedHint.trim().length,
            `Missing or empty hint for item "${item.id}" in "${locale}"`,
          ).toBeGreaterThan(0)
        }
      }
    }

    // English and unknown IDs fall back cleanly
    expect(translatePlaceIntro('kokiri', 'Fallback intro', 'en')).toBe('Fallback intro')
    expect(translateItemName('kokiri-gs-01', 'Fallback name', 'en')).toBe('Fallback name')
    expect(translateItemDesc('kokiri-gs-01', 'Fallback desc', 'en')).toBe('Fallback desc')
    expect(translateItemHint('kokiri-bean-01', 'Fallback hint', 'en')).toBe('Fallback hint')
    expect(translateItemName('nonexistent-item', 'Fallback name', 'es')).toBe('Fallback name')
  })
})
