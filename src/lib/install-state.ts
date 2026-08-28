// Pure install-prompt decision logic; use-install-prompt wraps it in React.
// iOS never fires beforeinstallprompt — there the row becomes an
// until-dismissed Share → Add to Home Screen guide instead of a native sheet.
// iPadOS 13+ reports a desktop-class "Macintosh" UA, so a multi-touch-capable
// Macintosh UA (maxTouchPoints > 1) counts as iPad.
export const INSTALL_DISMISS_KEY = 'labhub-install-dismissed'

export function isIosUa(ua: string, maxTouchPoints = 0): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
}

export function shouldShowInstall(state: {
  standalone: boolean
  isIos: boolean
  dismissed: boolean
  deferredAvailable: boolean
  tauri: boolean
}): boolean {
  if (state.standalone || state.dismissed || state.tauri) return false
  return state.isIos || state.deferredAvailable
}
