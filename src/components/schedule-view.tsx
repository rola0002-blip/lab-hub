'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { TZDate } from '@date-fns/tz'
import { addDays, format } from 'date-fns'
import BookingDialog from './booking-dialog'
import DraftBlock from '@/components/booking/draft-block'
import { useMediaQuery } from '@/components/hooks/use-media-query'
import {
  END_HOUR, ROWS, ROW_PX_DAY, ROW_PX_WEEK, START_HOUR,
  type Draft, moveDraft, resizeDraft, rowToDate, rowsToRange, seedDraft, slotRect,
} from '@/features/booking/grid'

export type CalSlot = {
  id: string; kind: 'booking' | 'maintenance'
  startsAt: string; endsAt: string; label: string; status?: string; own?: boolean
}

type Props = {
  equipmentId: string; timezone: string; weekStartISO: string
  slots: CalSlot[]; canManage: boolean; selfId: string; allowRecurring: boolean; retired: boolean
  equipmentName: string; equipmentLocation: string
  // Which day the phone day view opens on (0 = Monday, the week's first column).
  // Only the day bar's week-crossing links ever mint it; absent → today when the
  // viewed week contains today, else the first day.
  initialDay?: number
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
// Day-bar arrows: 44×44 is the touch bar, and both the interior (button) and the
// week-crossing (link) rendering wear it so the control never moves or resizes.
const DAY_NAV = 'flex h-11 w-11 items-center justify-center rounded-md text-lg text-default transition-colors hover:bg-hover'

export default function ScheduleView({ equipmentId, timezone, weekStartISO, slots, allowRecurring, retired, equipmentName, equipmentLocation, initialDay }: Props) {
  const weekStart = useMemo(() => new TZDate(new Date(weekStartISO), timezone), [weekStartISO, timezone])
  // md=768 is the ONLY layout breakpoint and (pointer: coarse) the ONLY gesture
  // predicate: width never gates the gesture (an iPad keeps the week grid AND the
  // touch gesture), pointer type never gates layout. Both hooks are SSR-false, so
  // the server paints the week grid and phones swap at hydration (accepted flash).
  const narrow = useMediaQuery('(max-width: 767px)')
  const coarse = useMediaQuery('(pointer: coarse)')
  const [drag, setDrag] = useState<{ day: number; from: number; to: number } | null>(null)
  // The coarse-pointer create gesture's whole state, DISJOINT from `drag` above:
  // a tap seeds it, the handles reshape it, Book turns it into a dialog range.
  // Under a fine pointer nothing ever sets it and no DraftBlock is mounted.
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dialog, setDialog] = useState<{ start: Date; end: Date } | null>(null)

  const todayKey = format(new TZDate(new Date(), timezone), 'yyyy-MM-dd')
  const dayKeys = useMemo(() => ALL_DAYS.map((d) => format(addDays(weekStart, d), 'yyyy-MM-dd')), [weekStart])
  const todayColumn = dayKeys.indexOf(todayKey)
  const todayIndexInWeek = todayColumn === -1 ? undefined : todayColumn
  // Seeded ONCE. Correct because the page mounts this component KEYED on
  // `${weekStartISO}:${initialDay}` — a ?week=/?day= soft navigation remounts it
  // rather than reconciling (the v0.12 projectOrderSignature idiom), so the seed
  // always describes the week being rendered. The remount also drops any open
  // dialog and in-flight drag for free.
  const [dayIndex, setDayIndex] = useState(() => Math.min(6, Math.max(0, initialDay ?? todayIndexInWeek ?? 0)))

  // One row height and one visible-day list drive every cell and slot rectangle,
  // so neither layout hardcodes geometry.
  const rowPx = narrow ? ROW_PX_DAY : ROW_PX_WEEK
  const visibleDays = narrow ? [dayIndex] : ALL_DAYS

  const rowDate = useCallback(
    (day: number, row: number): Date => rowToDate(weekStart, day, row, timezone),
    [weekStart, timezone],
  )

  const finishDrag = useCallback(() => {
    if (!drag || retired) return setDrag(null)
    const [a, b] = [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to) + 1]
    setDialog({ start: rowDate(drag.day, a), end: rowDate(drag.day, b) })
    setDrag(null)
  }, [drag, retired, rowDate])

  // Document-level backstop: a pointer released/cancelled outside the grid (above the
  // header, off-window, or a touch pointercancel) never reaches a cell, so own drag
  // completion here. This is the single completion path — cells have no onPointerUp.
  // Only ever armed by the fine-pointer machine: under a coarse pointer the cells
  // carry no handlers at all, so `drag` stays null and this effect never subscribes.
  useEffect(() => {
    if (!drag) return
    const onUp = () => finishDrag()
    const onCancel = () => setDrag(null)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    return () => {
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
    }
  }, [drag, finishDrag])

  // Week-crossing targets, derived from this component's own weekStart so the day
  // bar never depends on the page's link markup. Landing day is the far edge of the
  // neighbouring week, so ‹/› read as one continuous day sequence.
  const prevWeek = format(addDays(weekStart, -7), 'yyyy-MM-dd')
  const nextWeek = format(addDays(weekStart, 7), 'yyyy-MM-dd')

  // Interior day steps keep this component mounted, so the draft — which belongs to
  // the day it was seeded on — must be dropped by hand. The week-crossing links do
  // it for free: the page's key remounts us.
  function stepDay(delta: number) {
    setDraft(null)
    setDayIndex((d) => Math.min(6, Math.max(0, d + delta)))
  }

  return (
    <div className="select-none overflow-x-auto rounded-xl border border-border bg-surface">
      {narrow && (
        <div role="group" aria-label="Day" className="flex items-center justify-between gap-1 border-b border-border px-1 py-1">
          {/* `stepDay` updates functionally, not from `dayIndex ± 1`: two taps landing
              inside one render would otherwise both compute from the same closed-over
              index and the second would be swallowed. The clamps make each step total. */}
          {dayIndex > 0 ? (
            <button type="button" aria-label="Previous day" className={DAY_NAV} onClick={() => stepDay(-1)}>‹</button>
          ) : (
            <Link href={`?week=${prevWeek}&day=6`} aria-label="Previous day" className={DAY_NAV}>‹</Link>
          )}
          <span aria-live="polite" className={`text-sm ${dayKeys[dayIndex] === todayKey ? 'font-semibold text-[var(--text-accent)]' : 'font-medium text-default'}`}>
            {format(addDays(weekStart, dayIndex), 'EEE d MMM')}
          </span>
          {dayIndex < 6 ? (
            <button type="button" aria-label="Next day" className={DAY_NAV} onClick={() => stepDay(1)}>›</button>
          ) : (
            <Link href={`?week=${nextWeek}&day=0`} aria-label="Next day" className={DAY_NAV}>›</Link>
          )}
        </div>
      )}
      {/* The 720px floor is week-layout-only: the day view must fit a 375px screen
          without a horizontal scroller, which is what makes the overflow gate pass. */}
      <div className={narrow ? 'grid' : 'grid min-w-[720px]'} style={{ gridTemplateColumns: narrow ? '48px 1fr' : '48px repeat(7, 1fr)' }}>
        {!narrow && <div />}
        {!narrow && ALL_DAYS.map((d) => {
          const isToday = dayKeys[d] === todayKey
          return (
            <div key={d} className={`border-b border-l border-border p-2 text-center text-sm ${isToday ? 'font-semibold text-[var(--text-accent)]' : 'font-medium text-default'}`}>
              {format(addDays(weekStart, d), 'EEE d')}
            </div>
          )
        })}
        {/* time gutter */}
        <div className="relative" style={{ height: ROWS * rowPx }}>
          {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
            <span key={i} className="absolute right-1 text-[10px] text-subtle" style={{ top: i * 2 * rowPx - 6 }}>
              {String(START_HOUR + i).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {visibleDays.map((day) => {
          // Hoisted once per column: slotRect takes the day bounds as arguments.
          const dayStart = rowDate(day, 0)
          const dayEnd = rowDate(day, ROWS)
          return (
            <div key={day} data-day-col={day} className="relative border-l border-border" style={{ height: ROWS * rowPx }}
              onPointerLeave={coarse ? undefined : () => drag && finishDrag()}>
              {Array.from({ length: ROWS }, (_, row) => {
                const inDrag = drag?.day === day && row >= Math.min(drag.from, drag.to) && row <= Math.max(drag.from, drag.to)
                return (
                  <div key={row}
                    className={`absolute inset-x-0 transition-colors ${row % 2 ? '' : 'border-t border-border'} ${
                      inDrag ? 'bg-accent/20' : retired ? '' : coarse ? 'active:bg-hover' : 'cursor-crosshair hover:bg-hover'}`}
                    style={{ top: row * rowPx, height: rowPx }}
                    // Two disjoint machines, one per pointer class. Fine: the drag
                    // handlers below. Coarse: a tap seeds a draft (and tapping another
                    // empty slot re-seeds there), never the drag — so `drag` stays null
                    // and the document backstop stays unarmed.
                    onPointerDown={coarse ? undefined : () => !retired && setDrag({ day, from: row, to: row })}
                    onPointerEnter={coarse ? undefined : () => drag?.day === day && setDrag({ ...drag, to: row })}
                    onClick={coarse ? () => !retired && setDraft(seedDraft(day, row)) : undefined}
                  />
                )
              })}
              {slots.map((s) => {
                const r = slotRect(s, dayStart, dayEnd, rowPx)
                if (!r) return null
                const style = s.kind === 'maintenance'
                  ? 'bg-active text-muted border border-border'
                  : s.status === 'PENDING' ? 'bg-[var(--color-warning)]/15 text-default border border-[var(--color-warning)]/40'
                  : s.own ? 'bg-accent text-accent-on border border-[var(--accent)]'
                  : 'bg-accent-subtle text-[var(--text-accent)] border border-[var(--accent)]/30'
                return (
                  <div key={`${s.id}-${day}`} className={`pointer-events-none absolute inset-x-0.5 overflow-hidden rounded-md px-1 text-[11px] ${style}`}
                    style={{ top: r.top, height: r.height }}>
                    {s.label}{s.status === 'PENDING' ? ' (pending)' : ''}
                  </div>
                )
              })}
              {/* Last in the column so it stacks above the cells and the blocks. The
                  parent owns the Draft and applies grid.ts's pure transitions; the
                  block only reports rows. Nothing here completes on pointer release —
                  Book is an explicit press. */}
              {coarse && draft?.day === day && (
                <DraftBlock draft={draft} rowPx={rowPx}
                  onResize={(edge, row) => setDraft((d) => (d ? resizeDraft(d, edge, row) : d))}
                  onMove={(deltaRows) => setDraft((d) => (d ? moveDraft(d, deltaRows) : d))}
                  onBook={() => setDialog(rowsToRange(dayKeys[draft.day], draft.startRow, draft.endRow, timezone))}
                  onDiscard={() => setDraft(null)} />
              )}
            </div>
          )
        })}
      </div>
      {retired && <p className="p-2 text-sm text-muted">This instrument is retired — no new bookings.</p>}
      {dialog && (
        <BookingDialog equipmentId={equipmentId} timezone={timezone} allowRecurring={allowRecurring}
          equipmentName={equipmentName} equipmentLocation={equipmentLocation}
          initialStart={dialog.start} initialEnd={dialog.end} onClose={() => setDialog(null)}
          // Success retires the draft; CANCEL deliberately keeps it, so the user can
          // adjust the handles and try again. (A drag-opened dialog has none to clear.)
          onBooked={() => setDraft(null)} />
      )}
    </div>
  )
}
