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
// beforeinstallprompt fired before hydration is missed by design (spec §6) — the row appears on a later load.
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
    // Dismissal is read LIVE (not the mount-time snapshot) so an explicit
    // dismiss always wins, even when Chrome re-fires beforeinstallprompt in a
    // long-lived session after engagement re-qualification.
    const dismissedNow = () => window.localStorage.getItem(INSTALL_DISMISS_KEY) === '1'
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIos(isIos)
    const sync = (deferredAvailable: boolean) =>
      setShow(shouldShowInstall({ standalone, isIos, dismissed: dismissedNow(), deferredAvailable, tauri }))
    sync(false)
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as DeferredPrompt)
      sync(true)
    }
    const onInstalled = () => setShow(false)
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
    } catch (e) {
      console.warn('Install prompt failed:', e)
    }
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
