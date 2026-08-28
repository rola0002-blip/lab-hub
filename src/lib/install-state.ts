// Pure install-prompt decision logic; use-install-prompt wraps it in React.
// iOS never fires beforeinstallprompt — there the row becomes a one-time
// Share → Add to Home Screen guide instead of a native sheet.
export const INSTALL_DISMISS_KEY = 'labhub-install-dismissed'

export function isIosUa(ua: string): boolean {
  return /iPad|iPhone|iPod/.test(ua)
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
