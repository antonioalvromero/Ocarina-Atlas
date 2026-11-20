import { createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect } from 'react'
import { NotFound } from '../components/NotFound'
import { PlaceView } from '../components/PlaceView'
import { findPlace } from '../lib/data'
import { translatePlace, useI18n } from '../lib/i18n'

type ZoneSearch = {
  pin?: string
  item?: string
  map?: string
}

export const Route = createFileRoute('/$zone')({
  validateSearch: (search: Record<string, unknown>): ZoneSearch => ({
    pin: typeof search.pin === 'string' && search.pin.length > 0 ? search.pin : undefined,
    item: typeof search.item === 'string' && search.item.length > 0 ? search.item : undefined,
    map: typeof search.map === 'string' && search.map.length > 0 ? search.map : undefined,
  }),
  loader: ({ params }) => {
    const place = findPlace(params.zone)
    if (!place) throw notFound()
    return { place }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.place.name} | Ocarina Atlas` : 'Not found' }],
  }),
  component: ZonePage,
  notFoundComponent: NotFound,
})

function ZonePage() {
  const { place } = Route.useLoaderData()
  const { pin, item, map } = Route.useSearch()
  const { locale, t } = useI18n()

  useEffect(() => {
    if (typeof document === 'undefined') return
    const localizedName = translatePlace(locale, place.id, place.name)
    document.title = `${localizedName} | ${t('app.title')}`
  }, [locale, place.id, place.name, t])

  return <PlaceView key={place.id} place={place} initialItemId={pin ?? item} initialMapId={map} />
}
