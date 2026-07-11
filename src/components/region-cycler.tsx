'use client'
import { useEffect } from 'react'

// F6 / Shift+F6 cycles focus between the app's landmark region roots (elements
// marked `data-region-root`, each `tabIndex={-1}`): the primary nav, the search,
// the main content, and — when open — the thread panel. This is the standard
// desktop "next pane" affordance and must fire even while a text field is focused
// (e.g. the composer), so it is a bare window listener rather than useGlobalHotkey
// (which suppresses non-modifier keys inside inputs). The effect only adds/removes
// the listener — no setState — so it is clean under react-hooks/set-state-in-effect.
export function RegionCycler() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'F6' || e.altKey || e.ctrlKey || e.metaKey) return
      const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-region-root]'))
        .filter((el) => el.offsetParent !== null) // visible regions only
      if (roots.length === 0) return
      e.preventDefault()
      const active = document.activeElement as HTMLElement | null
      // Innermost containing region wins (the thread panel nests inside main), so
      // cycling from a nested region advances past it rather than sticking.
      const cur = roots.findLastIndex((r) => r === active || r.contains(active))
      const dir = e.shiftKey ? -1 : 1
      const next = roots[(cur + dir + roots.length) % roots.length]
      next.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return null
}
