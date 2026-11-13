import { createFileRoute, notFound } from '@tanstack/react-router'
import { NotFound } from '../components/NotFound'
import { PlaceView } from '../components/PlaceView'
import { findPlace } from '../lib/data'

export const Route = createFileRoute('/$zone')({
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
  return <PlaceView key={place.id} place={place} />
}
