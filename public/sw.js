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
