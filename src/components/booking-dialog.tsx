'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { AddToCalendar } from '@/components/calendar/add-to-calendar'
import { ROWS, START_HOUR, rangeToRows, rowLabel, rowsToRange } from '@/features/booking/grid'

type Props = {
  equipmentId: string; timezone: string; allowRecurring: boolean
  equipmentName: string; equipmentLocation: string
  initialStart: Date; initialEnd: Date; onClose: () => void
  // Optional: entry paths that own a draft selection clear it here once the
  // booking lands. The calendar's drag mount has nothing to clear and omits it.
  onBooked?: () => void
}
type Verdict = { kind: 'instant' } | { kind: 'approval'; why: string } | { kind: 'blocked'; reason: string; message: string }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The recurrence payload's two derived numbers. Module-pure on purpose: the
// preview effect reads them without pulling anything into its dependency array,
// which stays the PRIMITIVE row trio. A derived Date in those deps would be a
// fresh object every render and the preview fetch would re-arm itself forever.
const durationOf = (startRow: number, endRow: number) => (endRow - startRow) * 30
const startMinutesOf = (startRow: number) => START_HOUR * 60 + startRow * 30

const FIELD = 'mt-1 block rounded-md border border-border bg-surface px-3 py-2'

export default function BookingDialog({ equipmentId, timezone, allowRecurring, equipmentName, equipmentLocation, initialStart, initialEnd, onClose, onBooked }: Props) {
  const router = useRouter()
  const [purpose, setPurpose] = useState('')
  const [recurring, setRecurring] = useState(false)
  const [done, setDone] = useState<{ bookingId: string } | null>(null)
  // The editable range, held as the primitive trio and seeded ONCE from the
  // opening props — every entry path hands us an already row-aligned range, so
  // the seed is lossless, and later prop churn must not stomp an edit.
  const [range, setRange] = useState(() => rangeToRows(initialStart, initialEnd, timezone))
  const { dateStr, startRow, endRow } = range
  // Seed-once from the opening props too (deliberate): the weekday chip and the
  // four-week horizon describe where the dialog OPENED, not where it was edited to.
  const [days, setDays] = useState<number[]>(() => [new TZDate(initialStart, timezone).getDay()])
  const [until, setUntil] = useState(format(new TZDate(new Date(+initialStart + 28 * 86_400_000), timezone), 'yyyy-MM-dd'))
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const durationMinutes = durationOf(startRow, endRow)
  // Memoised on the trio so the instants are referentially stable. They are read
  // by the render and by submit — never by a dependency array (see above).
  const { start: startsAt, end: endsAt } = useMemo(
    () => rowsToRange(dateStr, startRow, endRow, timezone),
    [dateStr, startRow, endRow, timezone],
  )

  // Moving the start drags the end along only when it would otherwise be left at
  // or before it — the end select never offers a row the start has passed.
  const moveStart = (v: number) => setRange((r) => ({ ...r, startRow: v, endRow: Math.max(r.endRow, v + 1) }))

  // `<input type="date">` reports '' for a cleared or half-entered value (Backspace
  // on a segment, an Android picker's Clear). An empty dateStr would reach
  // rowsToRange as an Invalid Date and throw RangeError out of `format` below
  // DURING RENDER — and the app has no error.tsx, so Next would replace the whole
  // route and the half-filled dialog with it. Keep the last valid date instead;
  // React restores the input's displayed value to it.
  const setDate = (v: string) => { if (v) setRange((r) => ({ ...r, dateStr: v })) }

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const { start, end } = rowsToRange(dateStr, startRow, endRow, timezone)
        const r = await fetch('/api/bookings/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            equipmentId, startsAt: start, endsAt: end, purpose: '',
            ...(recurring ? { recurring: { daysOfWeek: days, startMinutes: startMinutesOf(startRow), durationMinutes: durationOf(startRow, endRow), firstDate: dateStr, untilDate: until } } : {}),
          }),
        })
        if (r.ok) setVerdict(await r.json())
      } catch { /* preview is best-effort — keep the last verdict on network/parse failure */ }
    }, 300)
    return () => clearTimeout(t)
  }, [equipmentId, dateStr, startRow, endRow, timezone, recurring, days, until])

  async function submit() {
    setBusy(true); setError(null); setConflicts([])
    try {
      const r = await fetch('/api/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId, startsAt, endsAt, purpose,
          ...(recurring ? { recurring: { daysOfWeek: days, startMinutes: startMinutesOf(startRow), durationMinutes, firstDate: dateStr, untilDate: until } } : {}),
        }),
      })
      const body = await r.json() // may throw on a non-JSON 5xx — caught below
      if (r.ok) {
        onBooked?.() // the slot is now real — let the opener drop its draft, both arms
        // Instant-confirmed bookings send no email — offer an in-app calendar path.
        // Pending requests are not yet an event, so close + refresh as before.
        if (body.pending === false && body.bookingId) { router.refresh(); setDone({ bookingId: body.bookingId }); return }
        onClose(); router.refresh(); return
      }
      if (body.error === 'conflicts') setConflicts(body.conflicts)
      else setError(body.message ?? 'Booking failed')
      if (r.status === 409 && body.error === 'slot_taken') router.refresh() // show the fresh calendar behind the dialog
    } catch {
      // Transport failure (offline / non-JSON 5xx): nothing actionable inline, so
      // surface a blameless toast with a one-tap Retry that re-runs the submit.
      toast("We couldn't reach the server — your booking wasn't saved.", { action: { label: 'Retry', onClick: () => void submit() } })
    } finally {
      setBusy(false)
    }
  }

  const when = `${format(new TZDate(startsAt, timezone), 'EEE d MMM, HH:mm')}–${format(new TZDate(endsAt, timezone), 'HH:mm')}`

  return (
    <Modal title="Book this slot" onClose={() => { if (!busy) onClose() }}>
      {done ? (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-default">Booked — <strong>{equipmentName}</strong>, {when}.</p>
          <AddToCalendar bookingId={done.bookingId} summary={equipmentName} startsAt={startsAt.toISOString()} endsAt={endsAt.toISOString()} purpose={purpose} location={equipmentLocation} />
          <div className="flex justify-end">
            <button onClick={onClose} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover">Done</button>
          </div>
        </div>
      ) : (
        <>
        {/* The range is editable from every entry path, so the dialog is one form:
            a drag lands here pre-filled and a cold open starts from a default. */}
        <label className="mt-1 block text-sm text-default">Date
          <input type="date" value={dateStr} onChange={(e) => setDate(e.target.value)}
            className={`${FIELD} w-full`} />
        </label>
        <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="text-sm text-default">From
            <select value={startRow} onChange={(e) => moveStart(Number(e.target.value))} className={FIELD}>
              {Array.from({ length: ROWS }, (_, r) => <option key={r} value={r}>{rowLabel(r)}</option>)}
            </select>
          </label>
          <label className="text-sm text-default">To
            {/* Rows start+1 … ROWS only, so an end at or before the start is unrepresentable. */}
            <select value={endRow} onChange={(e) => setRange((r) => ({ ...r, endRow: Number(e.target.value) }))} className={FIELD}>
              {Array.from({ length: ROWS - startRow }, (_, i) => startRow + 1 + i)
                .map((r) => <option key={r} value={r}>{rowLabel(r)}</option>)}
            </select>
          </label>
          <span className="py-2 text-sm text-muted">({(durationMinutes / 60).toFixed(1)} h)</span>
        </div>

        <label className="mt-4 block text-sm text-default">Purpose
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500}
            placeholder="e.g. hBN growth run" className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2" />
        </label>

        {allowRecurring && (
          <div className="mt-3 rounded-lg border border-border p-3 text-sm text-default">
            <label className="flex items-center gap-2"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />Repeat weekly</label>
            {recurring && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((w, i) => (
                    <label key={w} className={`cursor-pointer rounded-md border px-2 py-1 transition-colors ${days.includes(i) ? 'border-accent bg-accent/10 text-[var(--text-accent)]' : 'border-border hover:bg-hover'}`}>
                      <input type="checkbox" className="hidden" checked={days.includes(i)}
                        onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((d) => d !== i))} />{w}
                    </label>
                  ))}
                </div>
                <label className="block">Until (inclusive)
                  <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1 rounded-md border border-border bg-surface px-2 py-1" />
                </label>
              </div>
            )}
          </div>
        )}

        {verdict && (
          <p className={`mt-3 rounded-md p-2 text-sm text-default ${verdict.kind === 'blocked' ? 'bg-[var(--color-danger)]/10' : verdict.kind === 'approval' ? 'bg-[var(--color-warning)]/12' : 'bg-[var(--color-success)]/12'}`}>
            {verdict.kind === 'instant' && 'This booking will confirm instantly.'}
            {verdict.kind === 'approval' && (verdict.why === 'guest_policy' ? 'Guests need approval on this instrument.' : 'This instrument requires approval for every booking.')}
            {verdict.kind === 'blocked' && verdict.message}
          </p>
        )}
        {error && <p className="mt-2 text-sm text-[var(--text-danger)]">{error}</p>}
        {conflicts.length > 0 && (
          <div className="mt-2 rounded-md bg-[var(--color-danger)]/10 p-2 text-sm text-default">
            <p>These occurrences clash — adjust the pattern:</p>
            <ul className="ml-4 list-disc">{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm text-default transition-colors hover:bg-hover">Cancel</button>
          <button disabled={busy || verdict?.kind === 'blocked' || (recurring && days.length === 0)} onClick={submit}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">
            {busy ? 'Booking…' : verdict?.kind === 'approval' ? 'Request booking' : 'Book'}
          </button>
        </div>
        </>
      )}
    </Modal>
  )
}
