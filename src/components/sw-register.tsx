'use client'
import { useEffect } from 'react'
import { healPushSubscription } from '@/lib/push-subscribe'

// Register /sw.js on every load — push + offline shell — instead of only on
// push opt-in (push-subscribe keeps its own idempotent register call), then
// run the launch-time push heal (re-POST rotated endpoints, re-mint
// granted-but-missing subscriptions — no-op unless permission is granted).
// Skipped in the desktop shell: its webviews never use the SW, and the push
// opt-in row is already shell-gated there.
export function SwRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || '__TAURI__' in window || !('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js')
      .then(() => healPushSubscription())
      .catch((e) => console.warn('SW registration failed:', e))
  }, [])
  return null
}
