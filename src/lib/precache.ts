import type { Dataset } from './types'

const STATIC_FILES = [
  '/content/maps/hyrule.webp',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
]

/** Everything the app needs to open any page offline. Item photos are cached on view instead. */
export function precacheUrls(dataset: Dataset, bundleFiles: string[]): string[] {
  const pages = ['/', ...dataset.places.map((place) => `/${place.slug}`)]
  const maps = [dataset.map.image, ...dataset.places.flatMap((place) => place.maps.map((map) => map.image))]
  const bundle = bundleFiles.filter((file) => file.startsWith('assets/')).map((file) => `/${file}`)
  return [...new Set([...pages, ...maps, ...bundle, ...STATIC_FILES])].filter(Boolean)
}
