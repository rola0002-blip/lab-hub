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
    () => localStorage.getItem(KEY) === '1' || (localStorage.getItem(KEY) === null && initial),
    () => initial,
  )
  const set = useCallback((on: boolean) => {
    localStorage.setItem(KEY, on ? '1' : '0')
    window.dispatchEvent(new Event('storage'))
    void fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ soundsEnabled: on }) })
  }, [])
  return { enabled, set }
}
