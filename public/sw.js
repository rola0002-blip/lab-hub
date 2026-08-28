// LabHub service worker: Web Push delivery + a minimal offline shell.
// The fetch handler ONLY catches failed navigations and serves the precached
// /offline.html — app data routes are force-dynamic and stay network-only.
const OFFLINE_CACHE = 'labhub-offline-v1'
const OFFLINE_URL = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((c) => c.add(OFFLINE_URL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('labhub-offline-') && k !== OFFLINE_CACHE).map((k) => caches.delete(k)))
      // Claim open clients so the offline shell protects the VERY first load
      // (otherwise controller only attaches on the next navigation).
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE_URL).then((r) => r || Response.error()),
    ),
  )
})

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'LabHub', body: '', url: '/' }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: data.tag, data: { url: data.url } }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(url); return client.focus() }
      }
      return clients.openWindow(url)
    }),
  )
})
