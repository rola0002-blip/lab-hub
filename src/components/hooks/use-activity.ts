'use client'
import { useEffect } from 'react'

// Reports user activity to /api/activity so the server's push-idle gate
// (2026-09 notifications design) can suppress phone buzzes while the member
// is at a keyboard or actively scrolling. Any tab counts. Throttled to one
// POST per minute per tab, with an immediate send on mount (arriving IS
// activity). Runs in the desktop shell too — a focused shell suppresses
// push like a browser tab.
export function useActivity(): void {
  useEffect(() => {
    const THROTTLE_MS = 60_000
    let last = 0
    const send = (force = false) => {
      const now = Date.now()
      if (!force && now - last < THROTTLE_MS) return
      last = now
      void fetch('/api/activity', { method: 'POST' }).catch(() => {})
    }
    send(true)
    const onGeneric = () => send()
    const onVisibility = () => { if (document.visibilityState === 'visible') send() }
    const opts: AddEventListenerOptions = { passive: true }
    window.addEventListener('focus', onGeneric, opts)
    window.addEventListener('pointerdown', onGeneric, opts)
    window.addEventListener('keydown', onGeneric, opts)
    window.addEventListener('scroll', onGeneric, opts)
    document.addEventListener('visibilitychange', onVisibility, opts)
    return () => {
      window.removeEventListener('focus', onGeneric)
      window.removeEventListener('pointerdown', onGeneric)
      window.removeEventListener('keydown', onGeneric)
      window.removeEventListener('scroll', onGeneric)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
