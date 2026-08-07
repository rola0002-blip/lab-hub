'use client'
import { useRef } from 'react'
import { clientYToRow, draftLabel, type Draft } from '@/features/booking/grid'

type Props = {
  draft: Draft
  rowPx: number
  // The parent owns the Draft and applies the pure transition from grid.ts.
  // `onResize` is ABSOLUTE (the row under the pointer — idempotent, so a repeated
  // row is free to drop); `onMove` is INCREMENTAL (rows since the last emitted
  // move) because `moveDraft` composes from the CURRENT draft, so a delta measured
  // from the gesture's anchor would compound on every pointermove.
  onResize: (edge: 'start' | 'end', row: number) => void
  onMove: (deltaRows: number) => void
  onBook: () => void
  onDiscard: () => void
}

// One live gesture at a time, held in a ref rather than state: a pointermove must
// not re-render on its own account (the parent's draft update already does), and
// the handler reads the value synchronously.
type Gesture = { mode: 'start' | 'end' | 'move'; lastRow: number }

// The handles straddle their edge (half outside the block) so even a one-row draft
// has two separated 44px grab targets. `touch-none` lives HERE and on the root and
// nowhere else — on a container it would kill page scrolling.
const HANDLE = 'group absolute inset-x-0 flex h-11 touch-none items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
const PILL = 'h-1.5 w-10 rounded-full bg-[var(--accent)] transition-colors group-hover:bg-[var(--accent-hover)] group-active:bg-[var(--accent-active)]'
const ACTION = 'pointer-events-auto h-11 shrink-0 rounded-md text-sm font-medium shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
// How far a handle reaches past its own edge (half of 44), the action bar's own
// height, and the block height at which the two 44px handle bands stop meeting in
// the middle — below it the bar moves out from under them, to just past the bottom
// handle's reach.
const HANDLE_REACH = 22
const BAR_PX = 44
const BAR_FITS_PX = 88

export default function DraftBlock({ draft, rowPx, onResize, onMove, onBook, onDiscard }: Props) {
  const gesture = useRef<Gesture | null>(null)
  const height = (draft.endRow - draft.startRow) * rowPx
  const barInside = height >= BAR_FITS_PX

  // Rows are always measured against the day COLUMN, never against the block: the
  // block moves under the pointer mid-gesture, the column does not.
  function rowUnder(el: Element, clientY: number): number | null {
    const col = el.closest('[data-day-col]')
    return col ? clientYToRow(clientY, col.getBoundingClientRect().top, rowPx) : null
  }

  // Takes the mode as an argument rather than currying it: a curried factory would
  // be CALLED during render, and react-hooks/refs (rightly) refuses a ref read there.
  function begin(mode: Gesture['mode'], e: React.PointerEvent<HTMLElement>) {
    const row = rowUnder(e.currentTarget, e.clientY)
    if (row === null) return
    // Best-effort: a synthetic e2e event carries no real pointerId. Without capture
    // the moves still arrive while the pointer is over the element, and the release
    // is implicit on pointerup/pointercancel either way.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no real pointer */ }
    gesture.current = { mode, lastRow: row }
  }

  // Bubbled from whichever surface began the gesture (and, once captured, from the
  // capture target wherever the pointer has wandered to).
  function move(e: React.PointerEvent<HTMLElement>) {
    const g = gesture.current
    if (!g) return
    // Self-heal instead of a document-level backstop (which is the FINE pointer's
    // single completion path and stays that way): if capture never took and the
    // pointer was released off the block, no pointerup reached us — but a later
    // move over the block arrives with no button down, and that is the tell.
    if (e.buttons === 0) return end()
    const row = rowUnder(e.currentTarget, e.clientY)
    if (row === null || row === g.lastRow) return
    // `moveDraft` clamps at the band edges while `lastRow` keeps tracking the
    // pointer, so a drag pushed past an edge needs the same travel back before the
    // block moves again — the same feel as dragging a window against a screen edge.
    if (g.mode === 'move') onMove(row - g.lastRow)
    else onResize(g.mode, row)
    g.lastRow = row
  }

  // Releasing is just forgetting the gesture — pointer capture releases implicitly,
  // and nothing opens on release (Book is explicit, unlike the fine-pointer drag).
  function end() { gesture.current = null }

  // The handles are real buttons, so they answer the keyboard too: one arrow press
  // nudges that edge by a row. Pointer gestures and this share `onResize`.
  function nudge(edge: 'start' | 'end', e: React.KeyboardEvent) {
    const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (!step) return
    e.preventDefault()
    onResize(edge, (edge === 'start' ? draft.startRow : draft.endRow) + step)
  }

  return (
    // Named as a group so the four buttons inside are announced with the range they
    // act on, and so the name re-announces as the handles reshape it.
    <div data-draft-block="" role="group" aria-label={`Draft booking ${draftLabel(draft)}`}
      style={{ top: draft.startRow * rowPx, height }}
      className="absolute inset-x-0.5 touch-none rounded-md border border-[var(--accent)] bg-accent/20"
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {/* Body drag surface, doubling as the range label. Rendered FIRST so the
          handles and the action bar stack above it — no z-index anywhere. */}
      <div className="absolute inset-0 px-1 py-0.5 text-[11px] font-medium text-[var(--text-accent)]"
        onPointerDown={(e) => begin('move', e)}>
        {draftLabel(draft)}
      </div>
      <button type="button" aria-label="Adjust start time" className={HANDLE} style={{ top: -HANDLE_REACH }}
        onPointerDown={(e) => begin('start', e)} onKeyDown={(e) => nudge('start', e)}>
        <span className={PILL} />
      </button>
      <button type="button" aria-label="Adjust end time" className={HANDLE} style={{ bottom: -HANDLE_REACH }}
        onPointerDown={(e) => begin('end', e)} onKeyDown={(e) => nudge('end', e)}>
        <span className={PILL} />
      </button>
      {/* Clear of both 44px handle bands: centred inside a tall enough block,
          otherwise just past the bottom handle's reach. The buttons never shrink —
          a week-grid column is ~96px wide, so the bar spills LEFT (justify-end) in
          preference to squeezing either target under 44px. The BAR itself is
          transparent to the pointer (only the two buttons take events), so its empty
          run does not swallow body drags across the width of a phone column. */}
      <div className="pointer-events-none absolute inset-x-0 flex items-center justify-end gap-1"
        style={{ top: barInside ? (height - BAR_PX) / 2 : height + HANDLE_REACH + 2 }}>
        {/* Visible text `Book`, accessible name `Book this draft`: the dialog this
            opens has its own `Book` submit, and substring name matching cannot tell
            two simultaneous `Book`s apart. */}
        <button type="button" aria-label="Book this draft" onClick={onBook}
          className={`${ACTION} bg-accent px-4 text-accent-on hover:bg-accent-hover active:bg-[var(--accent-active)]`}>
          Book
        </button>
        <button type="button" aria-label="Discard draft" onClick={onDiscard}
          className={`${ACTION} w-11 border border-border bg-surface text-lg text-default hover:bg-hover active:bg-active`}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  )
}
