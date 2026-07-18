'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Default trigger is a 28px icon button; pass `buttonClassName` to render a
// wider custom trigger (e.g. the sidebar's full-width workspace header).
const ICON_TRIGGER = 'flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-default'

export function Menu({ button, label, items, buttonClassName, align = 'right' }: {
  button: React.ReactNode; label: string
  items: { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }[]
  buttonClassName?: string
  // PREFERRED horizontal anchor (default 'right': popover grows leftward from the
  // trigger's right edge). It is only a hint — the pre-paint pass below flips to the
  // side with more room when the preferred side would spill past a clip bound, so a
  // left-positioned trigger (e.g. the list/board status chips) stays on-screen without
  // hard-coding 'left', and a right-edge trigger (row actions, top-bar avatar) stays
  // right. Set it to bias the tie when both sides fit (e.g. the create-issue modal's
  // leftmost chips prefer 'left' so the popover opens INTO the dialog).
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  // Placement is measured on open. Vertical: default 'down' matches the historical
  // layout, so menus that fit below their trigger are byte-for-byte unchanged; a popover
  // that would spill past the bottom of its nearest clipping ancestor (e.g. the
  // create-issue Modal panel, `overflow-y-auto`) flips up and/or caps its height with an
  // internal scroll. Horizontal: `left` starts from the `align` hint and flips the same
  // way when the preferred side would clip — this keeps a left-positioned status chip's
  // popover on-screen at narrow widths instead of running off the left edge.
  const [pos, setPos] = useState<{ up: boolean; left: boolean; maxH: number | null }>({ up: false, left: align === 'left', maxH: null })
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  // Measure before paint: choose the vertical AND horizontal side with room and cap to
  // the clip bound. Stale values from a prior open are corrected here before the browser
  // paints, so there is no visible flash and no reset-on-close is needed.
  useLayoutEffect(() => {
    if (!open) return
    const wrap = ref.current, menuEl = menuRef.current
    if (!wrap || !menuEl) return
    const trig = wrap.getBoundingClientRect()
    // Intersect every scroll/clip ancestor up to <body> for the visible region; fall
    // back to the viewport. A box that clips EITHER axis clips both (CSS coerces the
    // visible axis to auto), so one rect tightens all four bounds — this is how the
    // board's `overflow-x-auto` and the modal panel's `overflow-y-auto` are honoured.
    let boundTop = 0, boundBottom = window.innerHeight, boundLeft = 0, boundRight = window.innerWidth
    const clips = (v: string) => v === 'auto' || v === 'scroll' || v === 'hidden' || v === 'clip'
    for (let el = wrap.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el)
      if (clips(cs.overflowX) || clips(cs.overflowY)) {
        const r = el.getBoundingClientRect()
        boundTop = Math.max(boundTop, r.top); boundBottom = Math.min(boundBottom, r.bottom)
        boundLeft = Math.max(boundLeft, r.left); boundRight = Math.min(boundRight, r.right)
      }
    }
    const pad = 8
    // Vertical: flip up only when below lacks room and above has more.
    const menuH = menuEl.scrollHeight
    const spaceBelow = boundBottom - trig.bottom - pad
    const spaceAbove = trig.top - boundTop - pad
    const up = menuH > spaceBelow && spaceAbove > spaceBelow
    const avail = Math.max(0, up ? spaceAbove : spaceBelow)
    // Horizontal: a left-anchored popover grows rightward from the trigger's left edge;
    // a right-anchored one grows leftward from its right edge. Start from `align`, then
    // flip to the side with more room when the preferred side would spill past a bound.
    const menuW = menuEl.offsetWidth
    const roomIfLeft = boundRight - trig.left - pad
    const roomIfRight = trig.right - boundLeft - pad
    let left = align === 'left'
    if (left && menuW > roomIfLeft && roomIfRight > roomIfLeft) left = false
    else if (!left && menuW > roomIfRight && roomIfLeft > roomIfRight) left = true
    setPos({ up, left, maxH: menuH > avail ? Math.max(0, Math.floor(avail)) : null })
  }, [open, align])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={buttonClassName ?? ICON_TRIGGER}>{button}</button>
      {open && (
        <div role="menu" ref={menuRef} style={pos.maxH != null ? { maxHeight: pos.maxH } : undefined}
          className={`absolute z-40 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-menu ${
            pos.left ? 'left-0' : 'right-0'
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
