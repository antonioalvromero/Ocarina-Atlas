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
  getLocale,
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
  type Locale,
  type TranslationKey,
} from './i18n'

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

  it('exposes all 4 supported locales in LOCALE_OPTIONS', () => {
    expect(LOCALE_OPTIONS.map((o) => o.code)).toEqual(['en', 'es', 'fr', 'pt'])
  })

  it('persists locale changes to localStorage under oot-map:v1:lang', () => {
    const win = fakeWindow()
    vi.stubGlobal('window', win)

    setLocale('es')
    expect(win.localStorage.getItem(LANG_STORAGE_KEY)).toBe('es')
    expect(getLocale()).toBe('es')

    setLocale('fr')
    expect(win.localStorage.getItem(LANG_STORAGE_KEY)).toBe('fr')
    expect(getLocale()).toBe('fr')

    setLocale('pt')
    expect(win.localStorage.getItem(LANG_STORAGE_KEY)).toBe('pt')
    expect(getLocale()).toBe('pt')
  })

  it('ignores invalid persisted or requested locales and falls back to en', () => {
    const win = fakeWindow({ [LANG_STORAGE_KEY]: 'de' })
    vi.stubGlobal('window', win)

    expect(getLocale()).toBe('en')
    setLocale('invalid' as Locale)
    expect(win.localStorage.getItem(LANG_STORAGE_KEY)).toBe('de')
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

  it('interpolates parameters in translated strings', () => {
    expect(translate('en', 'world.itemsCompleted', { done: 3, total: 10 })).toBe('3 / 10 items completed')
    expect(translate('es', 'world.itemsCompleted', { done: 3, total: 10 })).toBe('3 / 10 objetos completados')
    expect(translate('fr', 'world.itemsCompleted', { done: 3, total: 10 })).toBe('3 / 10 objets complétés')
    expect(translate('pt', 'world.itemsCompleted', { done: 3, total: 10 })).toBe('3 / 10 itens concluídos')
  })

  it('translates categories, places, regions, and requirements across all locales', () => {
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

  it('has complete, non-empty UI message translations for all 4 locales', () => {
    const enKeys = Object.keys(MESSAGES.en) as TranslationKey[]
    const locales: Locale[] = ['en', 'es', 'fr', 'pt']

    for (const locale of locales) {
      const dict = MESSAGES[locale]
      expect(Object.keys(dict).sort()).toEqual([...enKeys].sort())
      for (const key of enKeys) {
        expect(dict[key], `Missing or empty key "${key}" in locale "${locale}"`).toBeTruthy()
      }
    }
  })

  it('covers every category, place, region, and requirement in oot.json for all 4 locales', () => {
    const locales: Locale[] = ['en', 'es', 'fr', 'pt']
    const uniqueRegions = Array.from(new Set(dataset.places.map((p) => p.region)))

    for (const locale of locales) {
      for (const category of dataset.categories) {
        expect(
          CATEGORY_LABELS[locale][category.key],
          `Missing category "${category.key}" for "${locale}"`,
        ).toBeTruthy()
      }

      for (const place of dataset.places) {
        expect(
          PLACE_LABELS[locale][place.id],
          `Missing place "${place.id}" for "${locale}"`,
        ).toBeTruthy()
      }

      for (const region of uniqueRegions) {
        expect(
          REGION_LABELS[locale][region],
          `Missing region "${region}" for "${locale}"`,
        ).toBeTruthy()
      }

      for (const req of dataset.requirements) {
        expect(
          REQUIREMENT_LABELS[locale][req.key],
          `Missing requirement "${req.key}" for "${locale}"`,
        ).toBeTruthy()
      }
    }
  })

  it('covers every place intro and every item name, desc, and non-null hint in es, fr, and pt', () => {
    const locales: Locale[] = ['es', 'fr', 'pt']

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
