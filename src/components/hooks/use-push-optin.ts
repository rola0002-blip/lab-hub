'use client'
import { useEffect, useState } from 'react'

// VAPID public keys are base64url; the Push API wants the raw bytes as a BufferSource.
// Back the view with a concrete ArrayBuffer so it satisfies applicationServerKey's type.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// The subscribe flow, extracted so the tray opt-in and the notification wizard
// share one path: register SW → VAPID key → subscribe → POST. Failures are
// swallowed with console.warn (returns false) so no caller's surface breaks.
export async function subscribeToPush(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    const vr = await fetch('/api/push/vapid')
    const { publicKey } = await vr.json()
    if (!publicKey) return false // push disabled server-side (no VAPID keys)
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
    const j = sub.toJSON()
    await fetch('/api/push/subscription', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
    })
    return true
  } catch (e) {
    console.warn('Push opt-in failed:', e)
    return false
  }
}

// Web Push opt-in state, extracted so the notification tray can render the
// opt-in inline. Opt-in must never break the surface it lives on, so every
// failure is swallowed with console.warn (inside subscribeToPush). SSR-safe:
// `show` stays false until the client confirms service-worker support AND that
// this device isn't already subscribed; a successful `enable()` flips it back
// off so the affordance vanishes.
export function usePushOptIn(): { show: boolean; busy: boolean; enable: () => Promise<void> } {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Unavailable in the desktop shell (`__TAURI__`): native toasts come from
    // the shell's notify bridge instead. The explicit check matters on Windows,
    // where WebView2 ships serviceWorker and the row would otherwise appear —
    // pointing at push endpoints that never fire inside the shell.
    if (typeof window === 'undefined' || '__TAURI__' in window || !('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return
    let cancelled = false
    void (async () => {
      try {
        if (Notification.permission === 'granted') {
          const reg = await navigator.serviceWorker.getRegistration()
          if (reg && (await reg.pushManager.getSubscription())) return // already subscribed → stay hidden
        }
      } catch { /* fall through and offer the opt-in */ }
      // setShow runs inside a nested async IIFE (after awaited SW/subscription checks), so it
      // is not a synchronous setState-in-effect — no lint suppression needed.
      if (!cancelled) setShow(true)
    })()
    return () => { cancelled = true }
  }, [])

  async function enable() {
    setBusy(true)
    try {
      if (await subscribeToPush()) setShow(false) // a successful subscribe flips the row off
    } finally {
      setBusy(false)
    }
  }

  return { show, busy, enable }
}
