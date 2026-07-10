'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { TZDate } from '@date-fns/tz'
import { addDays, format } from 'date-fns'
import BookingDialog from './booking-dialog'

export type CalSlot = {
  id: string; kind: 'booking' | 'maintenance'
  startsAt: string; endsAt: string; label: string; status?: string; own?: boolean
}

const START_HOUR = 7, END_HOUR = 23, ROWS = (END_HOUR - START_HOUR) * 2, ROW_PX = 22

type Props = {
  equipmentId: string; timezone: string; weekStartISO: string
  slots: CalSlot[]; canManage: boolean; selfId: string; allowRecurring: boolean; retired: boolean
}

export default function WeekCalendar({ equipmentId, timezone, weekStartISO, slots, allowRecurring, retired }: Props) {
  const weekStart = useMemo(() => new TZDate(new Date(weekStartISO), timezone), [weekStartISO, timezone])
  const [drag, setDrag] = useState<{ day: number; from: number; to: number } | null>(null)
  const [dialog, setDialog] = useState<{ start: Date; end: Date } | null>(null)

  const rowToDate = useCallback((day: number, row: number): Date => {
    const d = addDays(weekStart, day)
    const t = new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), START_HOUR + Math.floor(row / 2), (row % 2) * 30, timezone)
    return new Date(+t)
  }, [weekStart, timezone])

  function slotRect(s: CalSlot, day: number): { top: number; height: number } | null {
    const dayStart = rowToDate(day, 0)
    const dayEnd = rowToDate(day, ROWS)
    const a = new Date(s.startsAt), b = new Date(s.endsAt)
    if (b <= dayStart || a >= dayEnd) return null
    const clampA = Math.max(+a, +dayStart), clampB = Math.min(+b, +dayEnd)
    const top = ((clampA - +dayStart) / 60_000 / 30) * ROW_PX
    return { top, height: Math.max(((clampB - clampA) / 60_000 / 30) * ROW_PX, 10) }
  }

  const finishDrag = useCallback(() => {
    if (!drag || retired) return setDrag(null)
    const [a, b] = [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to) + 1]
    setDialog({ start: rowToDate(drag.day, a), end: rowToDate(drag.day, b) })
    setDrag(null)
  }, [drag, retired, rowToDate])

  // Document-level backstop: a pointer released/cancelled outside the grid (above the
  // header, off-window, or a touch pointercancel) never reaches a cell, so own drag
  // completion here. This is the single completion path — cells have no onPointerUp.
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

  const todayKey = format(new TZDate(new Date(), timezone), 'yyyy-MM-dd')

  return (
    <div className="select-none overflow-x-auto rounded-xl border border-border bg-surface">
      <div className="grid min-w-[720px]" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
        <div />
        {Array.from({ length: 7 }, (_, d) => {
          const dayDate = addDays(weekStart, d)
          const isToday = format(dayDate, 'yyyy-MM-dd') === todayKey
          return (
            <div key={d} className={`border-b border-l border-border p-2 text-center text-sm ${isToday ? 'font-semibold text-accent' : 'font-medium text-default'}`}>
              {format(dayDate, 'EEE d')}
            </div>
          )
        })}
        {/* time gutter */}
        <div className="relative" style={{ height: ROWS * ROW_PX }}>
          {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
            <span key={i} className="absolute right-1 text-[10px] text-subtle" style={{ top: i * 2 * ROW_PX - 6 }}>
              {String(START_HOUR + i).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {Array.from({ length: 7 }, (_, day) => (
          <div key={day} className="relative border-l border-border" style={{ height: ROWS * ROW_PX }}
            onPointerLeave={() => drag && finishDrag()}>
            {Array.from({ length: ROWS }, (_, row) => {
              const inDrag = drag?.day === day && row >= Math.min(drag.from, drag.to) && row <= Math.max(drag.from, drag.to)
              return (
                <div key={row}
                  className={`absolute inset-x-0 transition-colors ${row % 2 ? '' : 'border-t border-border'} ${inDrag ? 'bg-accent/20' : retired ? '' : 'cursor-crosshair hover:bg-hover'}`}
                  style={{ top: row * ROW_PX, height: ROW_PX }}
                  onPointerDown={() => !retired && setDrag({ day, from: row, to: row })}
                  onPointerEnter={() => drag?.day === day && setDrag({ ...drag, to: row })}
                />
              )
            })}
            {slots.map((s) => {
              const r = slotRect(s, day)
              if (!r) return null
              const style = s.kind === 'maintenance'
                ? 'bg-active text-muted border border-border'
                : s.status === 'PENDING' ? 'bg-[var(--color-warning)]/15 text-default border border-[var(--color-warning)]/40'
                : s.own ? 'bg-accent text-accent-on border border-[var(--accent)]'
                : 'bg-accent-subtle text-accent border border-[var(--accent)]/30'
              return (
                <div key={`${s.id}-${day}`} className={`pointer-events-none absolute inset-x-0.5 overflow-hidden rounded-md px-1 text-[11px] ${style}`}
                  style={{ top: r.top, height: r.height }}>
                  {s.label}{s.status === 'PENDING' ? ' (pending)' : ''}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {retired && <p className="p-2 text-sm text-muted">This instrument is retired — no new bookings.</p>}
      {dialog && (
        <BookingDialog equipmentId={equipmentId} timezone={timezone} allowRecurring={allowRecurring}
          initialStart={dialog.start} initialEnd={dialog.end} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}
