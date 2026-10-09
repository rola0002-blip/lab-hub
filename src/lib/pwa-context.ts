// Client-safe standalone-PWA detection for the notification funnel. iOS only
// exposes navigator.standalone inside the home-screen app; Chromium installed
// apps report display-mode: standalone. The Tauri shell is excluded upstream
// by its own __TAURI__ gates (sw-register, decideAlert's inShell branch).
export function inStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { standalone?: boolean })
  return nav?.standalone === true
}
