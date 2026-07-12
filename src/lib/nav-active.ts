// Longest-prefix-wins active state for the sidebar rail. Exact match always wins;
// otherwise a nested path (`href + '/'`) activates an item ONLY when no OTHER nav
// href is a longer matching prefix of the path. This resolves the sibling-prefix
// collision where `/issues/me` would otherwise light up both "My issues" and
// "Issues" (the old `pathname === href || pathname.startsWith(href + '/')` rule).
// `hrefs` is every NAV_SECTIONS item's href.
export function isNavItemActive(pathname: string, href: string, hrefs: string[]): boolean {
  if (pathname === href) return true
  if (!pathname.startsWith(href + '/')) return false
  // A nested match is beaten by any longer sibling href that also matches.
  return !hrefs.some((other) =>
    other !== href &&
    other.length > href.length &&
    (pathname === other || pathname.startsWith(other + '/')),
  )
}
