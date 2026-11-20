import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import { dataset } from './data'
import { preloadLocale } from './i18n'
import { getQuickBrowsePlaces, normalizeSearchText, searchAtlas } from './search'

describe('normalizeSearchText', () => {
  it('strips diacritics, lowercases, and trims whitespace', () => {
    expect(normalizeSearchText('  Montaña de la Muerte  ')).toBe('montana de la muerte')
    expect(normalizeSearchText('Forêt Kokiri — Épée')).toBe('foret kokiri — epee')
    expect(normalizeSearchText('Templo del Espíritu')).toBe('templo del espiritu')
  })
})

describe('searchAtlas', () => {
  it('returns empty results for empty or whitespace queries', () => {
    expect(searchAtlas('')).toEqual({ places: [], items: [] })
    expect(searchAtlas('   \t\n  ')).toEqual({ places: [], items: [] })
  })

  it('finds places and collectibles by English name', () => {
    const result = searchAtlas('Kokiri Forest', { locale: 'en' })
    expect(result.places.length).toBeGreaterThan(0)
    expect(result.places[0]?.id).toBe('kokiri')
    expect(result.places[0]?.slug).toBe('kokiri-forest')
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.some((item) => item.placeId === 'kokiri')).toBe(true)
  })

  it('supports accent-insensitive localized search in Spanish and French', async () => {
    await Promise.all([preloadLocale('es'), preloadLocale('fr')])
    const esResult = searchAtlas('montana de la muerte', { locale: 'es' })
    expect(esResult.places.some((place) => place.id === 'sendero' || place.id === 'crater')).toBe(true)

    const frResult = searchAtlas('foret kokiri', { locale: 'fr' })
    expect(frResult.places[0]?.id).toBe('kokiri')
  })

  it('matches both localized and English terms when a non-English locale is active', async () => {
    await preloadLocale('es')
    const byLocalized = searchAtlas('Templo del Fuego', { locale: 'es' })
    const byEnglish = searchAtlas('Fire Temple', { locale: 'es' })
    expect(byLocalized.places[0]?.id).toBe('fuego')
    expect(byEnglish.places[0]?.id).toBe('fuego')
    expect(byEnglish.places[0]?.name).toBe('Templo del Fuego')
  })

  it('matches collectibles by category label and multi-token place + category queries', () => {
    const result = searchAtlas('kokiri skulltula', { locale: 'en' })
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items[0]?.placeId).toBe('kokiri')
    expect(result.items[0]?.cat).toBe('gs')
    expect(result.items.filter((item) => item.placeId === 'kokiri' && item.cat === 'gs').length).toBe(3)

    const hearts = searchAtlas('Piece of Heart', { locale: 'en' })
    expect(hearts.items.length).toBeGreaterThan(0)
    expect(hearts.items[0]?.cat).toBe('heart')
  })

  it('marks done status on items and computes doneCount on places', () => {
    const kokiriItem = dataset.items.find((item) => item.place === 'kokiri')
    expect(kokiriItem).toBeDefined()
    const doneIds = new Set([kokiriItem!.id])

    const result = searchAtlas('Kokiri Forest', { locale: 'en', doneIds })
    const kokiriPlace = result.places.find((p) => p.id === 'kokiri')
    expect(kokiriPlace?.doneCount).toBe(1)
    expect(kokiriPlace?.totalCount).toBeGreaterThan(1)

    const matchedItem = result.items.find((i) => i.id === kokiriItem!.id)
    expect(matchedItem?.done).toBe(true)
  })

  it('returns normalized floor metadata for dungeon items and omits principal floorLabel', () => {
    const basementItem = dataset.items.find((item) => item.at?.map === 'S1')
    expect(basementItem).toBeDefined()
    const basementRes = searchAtlas(basementItem!.name, { locale: 'en', maxItems: 50 })
    const foundBasement = basementRes.items.find((i) => i.id === basementItem!.id)
    expect(foundBasement?.floor).toBe('S1')
    expect(foundBasement?.floorLabel).toBe('B1')

    const principalItem = dataset.items.find((item) => item.at?.map === 'principal')
    expect(principalItem).toBeDefined()
    const principalRes = searchAtlas(principalItem!.name, { locale: 'en', maxItems: 50 })
    const foundPrincipal = principalRes.items.find((i) => i.id === principalItem!.id)
    expect(foundPrincipal?.floor).toBe('principal')
    expect(foundPrincipal?.floorLabel).toBeNull()
  })

  it('executes queries across all 32 places and 184 collectibles in under 16 ms', () => {
    expect(dataset.places).toHaveLength(32)
    expect(dataset.items).toHaveLength(184)

    // Warm up index for locale 'en'
    searchAtlas('temple', { locale: 'en' })

    const queries = ['skulltula', 'heart piece', 'kokiri', 'fire temple', 'bottle', 'fairy', 'bean']
    const start = performance.now()
    for (const q of queries) {
      searchAtlas(q, { locale: 'en' })
    }
    const elapsedMs = performance.now() - start
    expect(elapsedMs / queries.length).toBeLessThan(16)
  })
})

describe('getQuickBrowsePlaces', () => {
  it('returns all 32 places with completion counts', () => {
    const firstItem = dataset.items[0]!
    const places = getQuickBrowsePlaces({ locale: 'en', doneIds: [firstItem.id] })
    expect(places).toHaveLength(32)
    const owningPlace = places.find((p) => p.id === firstItem.place)
    expect(owningPlace?.doneCount).toBe(1)
  })
})
