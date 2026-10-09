// LabHub service worker: Web Push delivery + a minimal offline shell.
// The fetch handler ONLY catches failed navigations and serves the precached
// /offline.html — app data routes are force-dynamic and stay network-only.
// Bump the version when offline.html changes — installed copies keep the old
// precached page until the cache name changes.
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
      caches.open(OFFLINE_CACHE).then((c) => c.match(OFFLINE_URL)).then((r) => r || Response.error()),
    ),
  )
})

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'LabHub', body: '', url: '/' }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: data.tag, data: { url: data.url } }))
})

// VAPID keys are base64url; the Push API wants raw bytes (push-subscribe.ts parity).
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// Apple/Google rotate push endpoints; without a resubscribe the subscription
// silently dies (the server only prunes on 404/410). Re-mint, re-POST, and
// best-effort delete the superseded endpoint once the re-POST succeeded.
// Same-origin fetches carry the session cookie, so the POST authenticates
// like the wizard's own subscribe.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const oldEndpoint = event.oldSubscription && event.oldSubscription.endpoint
      const vr = await fetch('/api/push/vapid')
      const { publicKey } = await vr.json()
      if (!publicKey) return // push disabled server-side (no VAPID keys)
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const j = sub.toJSON()
      const res = await fetch('/api/push/subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
      })
      // fetch doesn't throw on 4xx/5xx — only retire the old endpoint once
      // the server actually accepted the replacement.
      if (res.ok && oldEndpoint && oldEndpoint !== j.endpoint) {
        await fetch('/api/push/subscription', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: oldEndpoint }),
        }).catch(() => { /* best-effort cleanup */ })
      }
    })(),
  )
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
