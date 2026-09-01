'use client'
import { useCallback, useEffect, useState } from 'react'
import { isIosUa } from '@/lib/install-state'

export type NotifyStatus = 'shell' | 'insecure' | 'ios-install' | 'unsupported' | 'denied' | 'ready' | 'done'

export type NotifyInputs = {
  tauri: boolean
  https: boolean // window.isSecureContext (true on HTTPS *and* localhost)
  ios: boolean
  standalone: boolean
  serviceWorker: boolean
  pushApi: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
}

// Pure decision (unit-tested): the wizard's per-device state, in priority
// order. 'ready' covers default *and* granted-but-unsubscribed — both render
// the Enable button, and enable() is idempotent.
export function notifyStatus(c: NotifyInputs): NotifyStatus {
  if (c.tauri) return 'shell'
  // A device can ship SW + PushManager yet no Notification API (some embedded
  // webviews) — it can never show the permission prompt, so it can never enable.
  if (c.permission === 'unsupported') return 'unsupported'
  if (!c.https) return 'insecure'
  if (c.ios && !c.standalone) return 'ios-install'
  if (!c.serviceWorker || !c.pushApi) return 'unsupported'
  if (c.permission === 'denied') return 'denied'
  if (c.permission === 'granted' && c.subscribed) return 'done'
  return 'ready'
}

export function useNotificationStatus(): { status: NotifyStatus | null; refresh: () => void } {
  const [inputs, setInputs] = useState<NotifyInputs | null>(null)
  // Plain closure over browser APIs + the stable setInputs, so [] deps are
  // safe — and refresh inherits that stability, letting consumers (Bell's
  // closeWizard useCallback) depend on it without re-creating their handlers.
  const read = useCallback(async () => {
    if (typeof window === 'undefined') return
    let subscribed = false
    try {
      if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration()
        subscribed = !!(reg && (await reg.pushManager.getSubscription()))
      }
    } catch { /* private mode etc. */ }
    setInputs({
      tauri: '__TAURI__' in window,
      https: window.isSecureContext,
      ios: isIosUa(window.navigator.userAgent, window.navigator.maxTouchPoints),
      standalone:
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
      serviceWorker: 'serviceWorker' in navigator,
      pushApi: 'PushManager' in window,
      permission: 'Notification' in window ? Notification.permission : 'unsupported',
      subscribed,
    })
  }, [])
  useEffect(() => {
    // read() is this hook's mount-time device probe: its setState fills the
    // null initial state (idempotent single read, no cascading renders) and
    // only runs after awaited registration checks on already-granted devices.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void read()
  }, [read])
  const refresh = useCallback(() => void read(), [read])
  return { status: inputs ? notifyStatus(inputs) : null, refresh }
}
