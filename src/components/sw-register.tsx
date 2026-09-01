'use client'
import { useEffect } from 'react'

// Register /sw.js on every load — push + offline shell — instead of only on
// push opt-in (push-subscribe keeps its own idempotent register call).
// Skipped in the desktop shell: its webviews never use the SW, and the push
// opt-in row is already shell-gated there.
export function SwRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || '__TAURI__' in window || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registration failed:', e))
  }, [])
  return null
}
