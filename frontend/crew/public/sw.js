// CypressWatch Crew service worker: saves the whole app (page shell, scripts,
// styles, fonts) when it installs, so it opens with no signal. App data is saved by the app itself (localStorage
// and IndexedDB), not here. Live API and sync calls always go to the network.
const VERSION = 'cw-crew-v3'
const SHELL_KEY = '/__shell'
const PRECACHE = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']
const SKIP = [/^\/api\//, /^\/ws\//, /^\/internal\//, /^\/v1\//, /^\/_deepspace\//, /^\/\.well-known\//]

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION)
    await cache.addAll(PRECACHE)
    // The page shell: every client route is served the same HTML.
    const shell = await fetch('/home', { cache: 'reload' })
    if (!shell.ok) throw new Error('shell not available')
    await cache.put(SHELL_KEY, shell)
    // Every built script, style and font, so the whole app works offline after one visit.
    // The list is written at build time (see vite.config.ts). Install fails if any file
    // cannot be saved, so the offline copy is never half-complete.
    const manifest = await (await fetch('/precache.json', { cache: 'reload' })).json()
    await cache.addAll(manifest.files)
    self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || SKIP.some((re) => re.test(url.pathname))) return

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION)
      try {
        const res = await fetch(req)
        if (res.ok && res.headers.get('content-type')?.includes('text/html')) cache.put(SHELL_KEY, res.clone())
        return res
      } catch {
        return (await cache.match(SHELL_KEY)) || Response.error()
      }
    })())
    return
  }

  event.respondWith((async () => {
    const cache = await caches.open(VERSION)
    const cached = await cache.match(req)
    const refresh = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    }).catch(() => undefined)
    return cached || (await refresh) || Response.error()
  })())
})
