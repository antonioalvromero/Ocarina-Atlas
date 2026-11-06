// VERSION and PRECACHE are prepended at build time by pwa/plugin.ts.
const SHELL_PREFIX = 'field-atlas-shell-'
const SHELL = SHELL_PREFIX + VERSION
const MEDIA = 'field-atlas-media'
// The server sends Vary: Origin, and module scripts carry an Origin header that precached requests do not.
const MATCH = { ignoreVary: true }

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(SHELL_PREFIX) && key !== SHELL).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  event.respondWith(respond(event.request, url))
})

/** Pages and assets only change with a deploy, which ships a new shell cache, so they are served cache-first. */
async function respond(request, url) {
  const shell = await caches.open(SHELL)
  const cached = await shell.match(request, { ...MATCH, ignoreSearch: request.mode === 'navigate' })
  if (cached) return cached
  if (url.pathname.startsWith('/content/media/')) return mediaResponse(request)
  return fetch(request)
}

/** Item photos are too heavy to precache, so each one is kept once it has been viewed. */
async function mediaResponse(request) {
  const media = await caches.open(MEDIA)
  const cached = await media.match(request, MATCH)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) await media.put(request, response.clone())
  return response
}
