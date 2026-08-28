import type { MetadataRoute } from 'next'

// Web app manifest — without this (display:standalone), iOS Safari opens the
// home-screen icon as a normal tab and reg.pushManager.subscribe() never
// registers, so the spec's "iOS support via installed PWA" push path is dead.
// `id` + `scope` pin install identity so later manifest edits don't orphan
// existing installs; background_color matches the dark canvas
// (globals.css:156 --bg-canvas) to avoid a white splash flash on dark
// devices. Light users see the inverse; a single manifest value can't
// media-query.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'LabHub',
    short_name: 'LabHub',
    description: 'Self-hosted lab platform',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#1a1d21',
    theme_color: '#0d9488',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Chat', url: '/chat', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Booking', url: '/booking', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Issues', url: '/issues', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  }
}
