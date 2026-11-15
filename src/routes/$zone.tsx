import { createFileRoute, notFound } from '@tanstack/react-router'
import { NotFound } from '../components/NotFound'
import { PlaceView } from '../components/PlaceView'
import { findPlace } from '../lib/data'

type ZoneSearch = {
  item?: string
  map?: string
}

export const Route = createFileRoute('/$zone')({
  validateSearch: (search: Record<string, unknown>): ZoneSearch => ({
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
  const { item, map } = Route.useSearch()
  return <PlaceView key={place.id} place={place} initialItemId={item} initialMapId={map} />
}
