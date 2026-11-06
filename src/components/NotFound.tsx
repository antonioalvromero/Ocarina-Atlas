import { Link } from '@tanstack/react-router'

export function NotFound() {
  return (
    <main className="grid h-dvh place-items-center p-6 text-center">
      <div>
        <h1 className="font-serif text-3xl text-parchment-50">Uncharted ground</h1>
        <p className="mt-2 text-parchment-400">No place on the atlas matches this address.</p>
        <Link to="/" className="mt-5 inline-block rounded-md bg-parchment-200 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-parchment-50">
          Back to the map
        </Link>
      </div>
    </main>
  )
}
