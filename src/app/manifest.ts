import type { MetadataRoute } from 'next'

// Web app manifest — without this (display:standalone), iOS Safari opens the
// home-screen icon as a normal tab and reg.pushManager.subscribe() never
// registers, so the spec's "iOS support via installed PWA" push path is dead.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'COLOSSUS',
    short_name: 'COLOSSUS',
    description: 'Self-hosted lab platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0d9488',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
