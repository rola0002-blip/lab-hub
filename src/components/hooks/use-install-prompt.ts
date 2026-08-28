'use client'
import { useCallback, useEffect, useState } from 'react'
import { INSTALL_DISMISS_KEY, isIosUa, shouldShowInstall } from '@/lib/install-state'

type DeferredPrompt = Event & {
  prompt: () => Promise<void>
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Install-app affordance state for the bell tray (usePushOptIn pattern:
// SSR-safe, shell-gated, every failure swallowed). Chromium: capture
// beforeinstallprompt and show the native sheet. iOS: no prompt event exists,
// so the row expands into an until-dismissed Share → Add to Home Screen guide.
export function useInstallPrompt(): {
  show: boolean
  isIos: boolean
  guideOpen: boolean
  openGuide: () => void
  promptInstall: () => Promise<void>
  dismiss: () => void
} {
  const [show, setShow] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [ios, setIos] = useState(false)
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    const isIos = isIosUa(window.navigator.userAgent, window.navigator.maxTouchPoints)
    const tauri = '__TAURI__' in window
    const dismissed = window.localStorage.getItem(INSTALL_DISMISS_KEY) === '1'
    // setIos/sync(false) hydrate mount-only browser facts (UA, display-mode,
    // dismiss flag) in one burst on mount — SSR-safe gating, not a cascading
    // render; the same suppression idiom as Bell's fetch-on-mount load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIos(isIos)
    const sync = (deferredAvailable: boolean) =>
      setShow(shouldShowInstall({ standalone, isIos, dismissed, deferredAvailable, tauri }))
    sync(false)
    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as DeferredPrompt)
      sync(true)
    }
    const onInstalled = () => setShow(false)
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
    } catch { /* best-effort */ }
    setDeferred(null)
    setShow(false)
  }, [deferred])

  const openGuide = useCallback(() => setGuideOpen(true), [])

  const dismiss = useCallback(() => {
    try { window.localStorage.setItem(INSTALL_DISMISS_KEY, '1') } catch { /* private mode */ }
    setShow(false)
    setGuideOpen(false)
  }, [])

  return { show, isIos: ios, guideOpen, openGuide, promptInstall, dismiss }
}
