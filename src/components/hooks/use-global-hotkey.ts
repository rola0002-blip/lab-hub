'use client'
import { useEffect, useRef } from 'react'

export function useGlobalHotkey(key: string, handler: (e: KeyboardEvent) => void, opts: { meta?: boolean } = {}) {
  // Keep the latest handler in a ref so the keydown listener never needs to
  // re-subscribe when `handler` changes. Sync in an effect (not during render)
  // to satisfy react-hooks/refs — a ref write here is allowed and is not setState.
  const cb = useRef(handler)
  useEffect(() => { cb.current = handler })
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== key.toLowerCase()) return
      if (opts.meta && !(e.metaKey || e.ctrlKey)) return
      if (!opts.meta) {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
      }
      e.preventDefault(); cb.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, opts.meta])
}
