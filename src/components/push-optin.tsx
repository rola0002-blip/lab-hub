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

// Web Push opt-in button beside the bell. Opt-in must never break the header, so every
// failure is swallowed with console.warn. SSR-safe: renders nothing until the client
// confirms service-worker support and that the user isn't already subscribed.
export default function PushOptIn() {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window) || !('PushManager' in window)) return
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
      const reg = await navigator.serviceWorker.register('/sw.js')
      const vr = await fetch('/api/push/vapid')
      const { publicKey } = await vr.json()
      if (!publicKey) { setShow(false); return } // push disabled server-side (no VAPID keys)
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const j = sub.toJSON()
      await fetch('/api/push/subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }),
      })
      setShow(false)
    } catch (e) {
      console.warn('Push opt-in failed:', e)
    } finally {
      setBusy(false)
    }
  }

  if (!show) return null
  return (
    <button onClick={enable} disabled={busy} title="Enable desktop notifications" aria-label="Enable desktop notifications"
      className="rounded-full p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50">
      <span aria-hidden>🔔</span><span aria-hidden className="text-xs">＋</span>
    </button>
  )
}
