'use client'
import { useSyncExternalStore, useCallback } from 'react'

// localStorage 'sounds' === '1' gates the chime on THIS device; the server
// column (User.soundsEnabled) is the cross-device default the profile seeds
// from — the exact theme/accent posture (device wins locally). An UNSET key
// falls back to `initial` so a fresh device inherits the server choice.
const KEY = 'sounds'
function subscribe(cb: () => void) {
  window.addEventListener('storage', cb)
  return () => window.removeEventListener('storage', cb)
}
export function useSoundsEnabled(initial = false) {
  const enabled = useSyncExternalStore(
    subscribe,
    () => {
      // Safari private mode can throw on storage access — treat that like an
      // unset key (falls back to `initial`) so the Bell never crashes.
      try {
        const v = localStorage.getItem(KEY)
        return v === '1' || (v === null && initial)
      } catch { return initial }
    },
    () => initial,
  )
  const set = useCallback((on: boolean) => {
    try { localStorage.setItem(KEY, on ? '1' : '0') } catch {} // Safari private mode throws; the toggle must not crash
    window.dispatchEvent(new Event('storage'))
    void fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ soundsEnabled: on }) })
  }, [])
  return { enabled, set }
}
