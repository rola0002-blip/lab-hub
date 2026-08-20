'use client'
import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return
    const node = ref.current
    const prev = document.activeElement as HTMLElement | null
    const first = node.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? node).focus()
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const firstEl = items[0], lastEl = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
    }
    node.addEventListener('keydown', onKey)
    // Restore only to a node still in the document: a row-scoped trigger can
    // unmount while the trap is active (chat's optimistic temp is replaced by
    // the server message); focusing a detached node is a silent no-op, so the
    // guard just makes that explicit — focus then stays where the browser put
    // it (body), never a dead reference.
    return () => { node.removeEventListener('keydown', onKey); if (prev?.isConnected) prev.focus() }
  }, [ref, active])
}
