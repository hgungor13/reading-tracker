/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// Precache the built app shell (injected by vite-plugin-pwa at build time).
precacheAndRoute(self.__WB_MANIFEST)

// Take over as soon as a new SW is installed (don't wait for all tabs to
// close), so `registerType: 'autoUpdate'` can apply new code on the next open.
self.addEventListener('install', () => {
  self.skipWaiting()
})

// Activate a new SW immediately so push handling updates without a reload.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

type PushPayload = {
  title?: string
  body?: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() }
  }

  const title = data.title ?? 'Reading Tracker'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body ?? "Don't forget to read today 📖",
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag ?? 'reading-reminder',
      data: { url: data.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string })?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
