'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TZDate } from '@date-fns/tz'
import { addDays, format } from 'date-fns'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { AddToCalendar } from '@/components/calendar/add-to-calendar'
import RequestTrainingButton from '@/components/booking/request-training-button'
import { wallTimeExists } from '@/lib/wall-time'
import { type Band, bandRows, rangeToRows, rowLabel, rowsToRange } from '@/features/booking/grid'

type Props = {
  equipmentId: string; timezone: string; allowRecurring: boolean
  equipmentName: string; equipmentLocation: string
  initialStart: Date; initialEnd: Date; onClose: () => void
  // The equipment's access window (grid.ts bandFor) and duration cap: the time
  // selects generate from the band, and the To select may extend past the band
  // close by up to maxDurationMinutes — an overnight run's 06:00 end is a row
  // past midnight, which policy (not the UI) admits or refuses.
  band: Band; maxDurationMinutes: number
  // Optional: entry paths that own a draft selection clear it here once the
  // booking lands. The calendar's drag mount has nothing to clear and omits it.
  onBooked?: () => void
  // v0.32: the server page's cert-gate projection (cert-gated instrument,
  // uncertified member/admin). The certification_required banner offers the ask
  // only when true — guests never see it (the service refuses them anyway).
  allowTrainingRequest?: boolean
}
type Verdict = { kind: 'instant' } | { kind: 'approval'; why: string } | { kind: 'blocked'; reason: string; message: string }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The recurrence payload's two derived numbers. Module-pure on purpose: the
// preview effect reads them without pulling anything into its dependency array,
// which stays the PRIMITIVE row trio. A derived Date in those deps would be a
// fresh object every render and the preview fetch would re-arm itself forever.
const durationOf = (startRow: number, endRow: number) => (endRow - startRow) * 30
const startMinutesOf = (startRow: number, band: Band) => band.startHour * 60 + startRow * 30

// Client DST guard, at the site where a select option resolves to a wall time:
// a skipped clock reading (02:30 on a US spring-forward Sunday) must not be
// offered, because the TZDate construction below would silently book 03:30.
// Rows past the band close roll into the NEXT calendar day, so the existence
// check resolves the rolled date, not the picked one.
const optionExists = (dateStr: string, row: number, band: Band, timezone: string): boolean => {
  const [y, m, d] = dateStr.split('-').map(Number)
  const hh = band.startHour + Math.floor(row / 2)
  const day = addDays(new Date(Date.UTC(y, m - 1, d)), Math.floor(hh / 24))
  return wallTimeExists(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh % 24, (row % 2) * 30, timezone)
}

const FIELD = 'mt-1 block rounded-md border border-border bg-surface px-3 py-2'

export default function BookingDialog({ equipmentId, timezone, allowRecurring, equipmentName, equipmentLocation, initialStart, initialEnd, band, maxDurationMinutes, onClose, onBooked, allowTrainingRequest }: Props) {
  const router = useRouter()
  const [purpose, setPurpose] = useState('')
  const [recurring, setRecurring] = useState(false)
  const [done, setDone] = useState<{ bookingId: string } | null>(null)
  // The editable range, held as the primitive trio and seeded ONCE from the
  // opening props — every entry path hands us an already row-aligned range, so
  // the seed is lossless, and later prop churn must not stomp an edit.
  const [range, setRange] = useState(() => rangeToRows(initialStart, initialEnd, timezone, band))
  const { dateStr, startRow, endRow } = range
  // Seed-once from the opening props too (deliberate): the weekday chip and the
  // four-week horizon describe where the dialog OPENED, not where it was edited to.
  const [days, setDays] = useState<number[]>(() => [new TZDate(initialStart, timezone).getDay()])
  const [until, setUntil] = useState(format(new TZDate(new Date(+initialStart + 28 * 86_400_000), timezone), 'yyyy-MM-dd'))
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const rows = bandRows(band)
  // The end select may run past the band close for an overnight run, bounded by
  // the policy duration cap measured from the selected start (the old 16-h
  // select ceiling is gone); the same-day band close stays selectable whatever
  // the cap, and the preview verdict still refuses what policy disallows.
  const maxEndRow = Math.max(rows, startRow + Math.floor(maxDurationMinutes / 30))
  const durationMinutes = durationOf(startRow, endRow)
  // Memoised on the trio so the instants are referentially stable. They are read
  // by the render and by submit — never by a dependency array (see above).
  const { start: startsAt, end: endsAt } = useMemo(
    () => rowsToRange(dateStr, startRow, endRow, timezone, band),
    [dateStr, startRow, endRow, timezone, band],
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
        const { start, end } = rowsToRange(dateStr, startRow, endRow, timezone, band)
        const r = await fetch('/api/bookings/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            equipmentId, startsAt: start, endsAt: end, purpose: '',
            ...(recurring ? { recurring: { daysOfWeek: days, startMinutes: startMinutesOf(startRow, band), durationMinutes: durationOf(startRow, endRow), firstDate: dateStr, untilDate: until } } : {}),
          }),
        })
        if (r.ok) setVerdict(await r.json())
      } catch { /* preview is best-effort — keep the last verdict on network/parse failure */ }
    }, 300)
    return () => clearTimeout(t)
  }, [equipmentId, dateStr, startRow, endRow, timezone, band, recurring, days, until])

  async function submit() {
    setBusy(true); setError(null); setConflicts([])
    try {
      const r = await fetch('/api/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId, startsAt, endsAt, purpose,
          ...(recurring ? { recurring: { daysOfWeek: days, startMinutes: startMinutesOf(startRow, band), durationMinutes, firstDate: dateStr, untilDate: until } } : {}),
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
              {Array.from({ length: rows }, (_, r) => (
                <option key={r} value={r} disabled={!optionExists(dateStr, r, band, timezone)}>{rowLabel(r, band)}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-default">To
            {/* Rows start+1 … max(maxEndRow, endRow), so an end at or before the
                start is unrepresentable, an overnight end past the band close is
                offered up to the duration cap (policy has the final word), and a
                To chosen under an earlier From stays listed — the select never
                shows a value it does not offer. */}
            <select value={endRow} onChange={(e) => setRange((r) => ({ ...r, endRow: Number(e.target.value) }))} className={FIELD}>
              {Array.from({ length: Math.max(maxEndRow, endRow) - startRow }, (_, i) => startRow + 1 + i)
                .map((r) => <option key={r} value={r} disabled={!optionExists(dateStr, r, band, timezone)}>{rowLabel(r, band)}</option>)}
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
                  <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1 rounded-md border border-border bg-surface px-3 py-1" />
                </label>
              </div>
            )}
          </div>
        )}

        {verdict && (
          <div className={`mt-3 rounded-md p-2 text-sm text-default ${verdict.kind === 'blocked' ? 'bg-[var(--color-danger)]/10' : verdict.kind === 'approval' ? 'bg-[var(--color-warning)]/12' : 'bg-[var(--color-success)]/12'}`}>
            <p>
              {verdict.kind === 'instant' && 'This booking will confirm instantly.'}
              {verdict.kind === 'approval' && (verdict.why === 'guest_policy' ? 'Guests need approval on this instrument.' : 'This instrument requires approval for every booking.')}
              {verdict.kind === 'blocked' && verdict.message}
            </p>
            {/* The certification gate is the one block with a constructive exit:
                ask for training without leaving the dialog. Nested modal over this
                one — Escape/close lands back here with the range still drafted. */}
            {verdict.kind === 'blocked' && verdict.reason === 'certification_required' && allowTrainingRequest && (
              <div className="mt-2">
                <RequestTrainingButton equipmentId={equipmentId} equipmentName={equipmentName} tone="accent" />
              </div>
            )}
          </div>
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
