'use client'
import { useCallback, useSyncExternalStore } from 'react'

// Subscribe to a CSS media query and re-render on change. Uses
// useSyncExternalStore (not a setState-in-effect) so it satisfies the repo's
// react-hooks lint rules and is safe under SSR/hydration: the server snapshot is
// always `false` (desktop-first), and the real match is read on the client's
// first commit. Callers that mount on client interaction (e.g. the thread drawer,
// which only appears after a click) therefore see the correct value immediately.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
