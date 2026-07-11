'use client'
import { useEffect, useRef, useState } from 'react'

// Default trigger is a 28px icon button; pass `buttonClassName` to render a
// wider custom trigger (e.g. the sidebar's full-width workspace header).
const ICON_TRIGGER = 'flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-default'

export function Menu({ button, label, items, buttonClassName }: {
  button: React.ReactNode; label: string
  items: { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }[]
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={buttonClassName ?? ICON_TRIGGER}>{button}</button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 min-w-44 rounded-lg bg-surface p-1 shadow-menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" disabled={it.disabled}
              onClick={() => { if (it.disabled) return; setOpen(false); it.onSelect() }}
              className={`block w-full rounded-md px-3 py-1.5 text-left text-sm ${
                it.disabled
                  ? 'cursor-not-allowed text-subtle opacity-50'
                  : `hover:bg-hover ${it.danger ? 'text-[var(--text-danger)]' : 'text-default'}`
              }`}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
