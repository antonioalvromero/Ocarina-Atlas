import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dataset } from './data'
import { precacheUrls } from './precache'

describe('precacheUrls', () => {
  const urls = precacheUrls(dataset, ['assets/index-abc.js', 'assets/styles-abc.css', '.vite/manifest.json'])

  it('covers the home page and every place page', () => {
    expect(urls).toContain('/')
    for (const place of dataset.places) expect(urls).toContain(`/${place.slug}`)
  })

  it('keeps hashed bundle assets only', () => {
    expect(urls).toContain('/assets/index-abc.js')
    expect(urls).toContain('/assets/styles-abc.css')
    expect(urls).not.toContain('/.vite/manifest.json')
  })

  it('lists no duplicates, since Cache.addAll rejects them', () => {
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('only lists public files that exist, since one missing file fails the install', () => {
    const files = urls.filter((url) => url.startsWith('/content/') || url.startsWith('/icons/') || url.includes('.webmanifest'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) expect(existsSync(`public${file}`), file).toBe(true)
  })
})
