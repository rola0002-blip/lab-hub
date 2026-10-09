// Per-device browser OS-popup preference (Task 9). localStorage
// 'labhub.popups' === '0' opts THIS device out of Notification popups for
// every alert (new chat messages and bell notifications); an UNSET key stays
// opted in (popups are the alert surface the wizard sells, so the default
// follows the granted permission).
// Permission itself is NOT stored here — the funnel checks
// Notification.permission at fire time.
const KEY = 'labhub.popups'

export function popupPref(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true // Safari private mode etc. — never crash the alert funnel
  }
}

export function setPopupPref(v: boolean): void {
  try {
    localStorage.setItem(KEY, v ? '1' : '0')
  } catch { /* Safari private mode throws; the toggle must not crash */ }
}
