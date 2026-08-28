// Home-screen/launcher unread badge (Badging API). Called from the tab-title
// effect (chat-title-badge) with the SAME sumUnread derivation, so title and
// badge can never disagree. Pure sugar: clean no-op where unsupported (iOS
// Safari) and swallowed rejections in uninstalled contexts — never an error
// surface for the caller.
export type BadgeNavigator = {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export function applyAppBadge(n: number, nav: BadgeNavigator = typeof navigator === 'undefined' ? {} : navigator): void {
  const p = n > 0 ? nav.setAppBadge?.(n) : nav.clearAppBadge?.()
  p?.catch(() => {}) /* SecurityError in uninstalled tabs is expected */
}
