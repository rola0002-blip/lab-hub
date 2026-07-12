'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Default trigger is a 28px icon button; pass `buttonClassName` to render a
// wider custom trigger (e.g. the sidebar's full-width workspace header).
const ICON_TRIGGER = 'flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-default'

export function Menu({ button, label, items, buttonClassName, align = 'right' }: {
  button: React.ReactNode; label: string
  items: { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }[]
  buttonClassName?: string
  // Horizontal anchor. Default 'right' (popover grows leftward from the trigger's
  // right edge) matches every historical call site — right-edge triggers (row
  // actions, the top-bar avatar, the properties panel). Pass 'left' when the trigger
  // sits at the LEFT of a narrow clipping container (e.g. the create-issue modal's
  // leftmost property chips): a right-anchored 176px popover would grow past the
  // dialog's left edge and be clipped by its `overflow` scroll box.
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  // Vertical placement is measured on open: default 'down' matches the historical
  // layout, so menus that fit below their trigger are byte-for-byte unchanged. When the
  // popover would spill past the bottom of its nearest clipping ancestor (e.g. the
  // create-issue Modal panel, which is `overflow-y-auto` and therefore clips
  // absolutely-positioned children) it flips up and/or caps its height with an internal
  // scroll so every item stays visible and clickable instead of being cut off.
  const [pos, setPos] = useState<{ up: boolean; maxH: number | null }>({ up: false, maxH: null })
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  // Measure before paint: pick the vertical side with room and cap to the clip bound.
  // Stale values from a prior open are corrected here before the browser paints, so
  // there is no visible flash and no reset-on-close is needed.
  useLayoutEffect(() => {
    if (!open) return
    const wrap = ref.current, menuEl = menuRef.current
    if (!wrap || !menuEl) return
    const trig = wrap.getBoundingClientRect()
    // Nearest scroll/clip ancestor bounds the popover; fall back to the viewport.
    let boundTop = 0, boundBottom = window.innerHeight
    for (let el = wrap.parentElement; el && el !== document.body; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY
      if (oy === 'auto' || oy === 'scroll' || oy === 'hidden' || oy === 'clip') {
        const r = el.getBoundingClientRect()
        boundTop = Math.max(boundTop, r.top); boundBottom = Math.min(boundBottom, r.bottom)
        break
      }
    }
    const pad = 8
    const menuH = menuEl.scrollHeight
    const spaceBelow = boundBottom - trig.bottom - pad
    const spaceAbove = trig.top - boundTop - pad
    const up = menuH > spaceBelow && spaceAbove > spaceBelow
    const avail = Math.max(0, up ? spaceAbove : spaceBelow)
    setPos({ up, maxH: menuH > avail ? Math.max(0, Math.floor(avail)) : null })
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={buttonClassName ?? ICON_TRIGGER}>{button}</button>
      {open && (
        <div role="menu" ref={menuRef} style={pos.maxH != null ? { maxHeight: pos.maxH } : undefined}
          className={`absolute z-40 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-menu ${
            align === 'left' ? 'left-0' : 'right-0'
          } ${pos.up ? 'bottom-full mb-1' : 'top-full mt-1'}${pos.maxH != null ? ' overflow-y-auto' : ''}`}>
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
