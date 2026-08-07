'use client'
import { useCallback, useSyncExternalStore } from 'react'

// A software keyboard has to eat a real slice of the window before we believe it
// is one: iOS reports small visual/layout deltas for the URL bar and the
// scroll-into-view nudge, and neither should reflow the chat pane.
const KEYBOARD_MIN_PX = 80

// Height of the VISUAL viewport while a software keyboard is open, else null.
//
// iOS never resizes the LAYOUT viewport for the keyboard (the viewport export's
// `interactiveWidget: 'resizes-content'` is an Android-only hint), so 100dvh keeps
// reporting the full screen and anything pinned to the bottom of a dvh-sized pane
// sits under the keys. window.visualViewport is the only surface that reports the
// shrink; callers subtract their own measured top from this height.
//
// useSyncExternalStore (not a setState-in-effect) — the use-media-query.ts idiom,
// so it satisfies the repo's react-hooks rules and is SSR-safe: the server
// snapshot is `null` (no keyboard), and the real value is read on first commit.
// The snapshot is a primitive, so an unchanged reading never re-renders.
export function useVisualViewportHeight(): number | null {
  const subscribe = useCallback((onChange: () => void) => {
    const vv = window.visualViewport
    if (!vv) return () => {}
    vv.addEventListener('resize', onChange)
    return () => vv.removeEventListener('resize', onChange)
  }, [])
  const getSnapshot = useCallback(() => {
    const vv = window.visualViewport
    if (!vv) return null
    return window.innerHeight - vv.height > KEYBOARD_MIN_PX ? Math.round(vv.height) : null
  }, [])
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}
