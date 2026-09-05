'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { CalendarCheck, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Modal } from '@/components/ui/modal'
import { BOOKING_VARIANT } from '@/features/booking/chip'
import { SESSION_LATE_MS } from '@/features/booking/session'
import { AddToCalendar } from '@/components/calendar/add-to-calendar'
import { cancelMyBookingAction, logOnAction, logOffAction, saveSessionNoteAction } from './actions'

type Item = {
  id: string; equipmentName: string; when: string; status: string; recurring: boolean; cancellable: boolean; reason: string | null
  startsAt: string; endsAt: string; purpose: string; location: string
  sessionStartedAt: string | null; sessionEndedAt: string | null; sessionNote: string; sessionLabel: string | null
}

// The destructive text actions were unpadded (~20px) and ringless. `whitespace-nowrap`
// keeps "Cancel series" from breaking mid-label once the row wraps on a phone.
const CANCEL_BTN = 'rounded px-1 py-1.5 whitespace-nowrap text-[var(--text-danger)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

// W12-C session actions — accent text idiom (the CANCEL_BTN shape, non-destructive).
const SESSION_BTN = 'rounded px-1 py-1.5 whitespace-nowrap text-[var(--text-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

function Row({ b, upcoming, onErr }: { b: Item; upcoming: boolean; onErr: (m: string) => void }) {
  const [pending, start] = useTransition()
  const [noteOpen, setNoteOpen] = useState<{ mode: 'save' | 'end' } | null>(null)
  function cancel(scope: 'one' | 'future') {
    const q = scope === 'future' ? 'Cancel this and all future occurrences?' : 'Cancel this booking?'
    if (!confirm(q)) return
    start(async () => { const r = await cancelMyBookingAction(b.id, scope); if (!r.ok) onErr(r.message ?? 'Failed') })
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm transition-colors hover:bg-hover">
      <span className="text-default">
        <strong>{b.equipmentName}</strong> · {b.when}{b.recurring && ' · recurring'}
        {b.reason && <span className="block text-xs text-muted">Reason: {b.reason}</span>}
        {b.sessionEndedAt && b.sessionLabel && (
          <span className="block text-xs text-muted">Session: {b.sessionLabel}{b.sessionNote && <> · Notes: {b.sessionNote}</>}</span>
        )}
      </span>
      <span className="flex flex-wrap items-center justify-end gap-2">
        {upcoming && ['CONFIRMED', 'PENDING'].includes(b.status) && new Date(b.endsAt) > new Date() && (
          <AddToCalendar bookingId={b.id} summary={b.equipmentName} startsAt={b.startsAt} endsAt={b.endsAt} purpose={b.purpose} location={b.location} />
        )}
        {b.status === 'CONFIRMED' && !b.sessionStartedAt && !b.sessionEndedAt
          && new Date(b.endsAt).getTime() > new Date().getTime() - SESSION_LATE_MS && (
          // Loose visibility + strict server gate: a stale page may show the button a
          // touch early/late, and fresh loads are start-side window-blind by design
          // (the button shows on future bookings; the server answers with the exact
          // window message — never a stuck hidden button on a page loaded before the
          // window opened).
          <button type="button" disabled={pending}
            onClick={() => start(async () => { const r = await logOnAction(b.id); if (!r.ok) onErr(r.message ?? 'Failed') })}
            className={SESSION_BTN}>Log on</button>
        )}
        {b.sessionStartedAt && !b.sessionEndedAt && (
          <>
            {/* Note/Save-note requires CONFIRMED server-side; a cancelled-while-active
                row offers exactly one affordance — Log off, which still carries the
                note via the modal (logOffAction is status-free, deliberately). */}
            {b.status === 'CONFIRMED' && (
              <button type="button" className={SESSION_BTN} onClick={() => setNoteOpen({ mode: 'save' })}>Note</button>
            )}
            <button type="button" disabled={pending} className={SESSION_BTN} onClick={() => setNoteOpen({ mode: 'end' })}>Log off</button>
          </>
        )}
        <Badge variant={BOOKING_VARIANT[b.status as keyof typeof BOOKING_VARIANT]}>{b.status.toLowerCase()}</Badge>
        {b.cancellable && (
          <>
            <button type="button" disabled={pending} onClick={() => cancel('one')} className={CANCEL_BTN}>Cancel</button>
            {b.recurring && <button type="button" disabled={pending} onClick={() => cancel('future')} className={CANCEL_BTN}>Cancel series</button>}
          </>
        )}
      </span>
      {/* Modal stays open on failure (slot-details' contract): the error surfaces via
          the page-level msg and the typed note is preserved. */}
      {noteOpen && <SessionNoteModal bookingId={b.id} mode={noteOpen.mode} initial={b.sessionNote} onDone={() => setNoteOpen(null)} onErr={onErr} />}
    </li>
  )
}

// W12-C: the note editor behind both row actions — `save` is the mid-session Note
// button, `end` is Log off. `end` PREFILLS the current note and keeps it when the
// field is emptied (logOffAction's null/''-preserve semantics), which is why the
// label carries the "(optional)" hint rather than a "clears" one.
function SessionNoteModal({ bookingId, mode, initial, onDone, onErr }: {
  bookingId: string; mode: 'save' | 'end'; initial: string; onDone: () => void; onErr: (m: string) => void
}) {
  const [text, setText] = useState(initial)
  const [pending, start] = useTransition()
  function save(end: boolean) {
    start(async () => {
      const r = end ? await logOffAction(bookingId, text) : await saveSessionNoteAction(bookingId, text)
      if (!r.ok) { onErr(r.message ?? 'Failed'); return }
      onDone()
    })
  }
  return (
    <Modal title={mode === 'end' ? 'Log off session' : 'Session note'} onClose={onDone}>
      <label className="mt-1 block text-sm text-default">
        {mode === 'end' ? 'Note any issues from this session (optional)' : 'Session note'}
        <textarea rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onDone}
          className="min-h-11 rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
        {/* min-h-11 (44px touch bar) matches slot-details' session buttons — "Save &
            log off" is irreversible, so its target meets the touch minimum. */}
        <button type="button" disabled={pending} onClick={() => save(mode === 'end')}
          className="min-h-11 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
          {mode === 'end' ? 'Save & log off' : 'Save note'}
        </button>
      </div>
    </Modal>
  )
}

export default function BookingsClient({ upcoming, past }: { upcoming: Item[]; past: Item[] }) {
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="mt-6 space-y-8">
      {msg && <p className="text-sm text-[var(--text-danger)]">{msg}</p>}
      <section>
        <h2 className="font-medium text-default">Upcoming</h2>
        {/* The Upcoming list carries NO `overflow-hidden`: its rows render <AddToCalendar>,
            which is a shared <Menu> — a non-portaled absolute popover that menu.tsx caps to
            the space left inside its nearest clipping ancestor. A short Upcoming list is
            barely taller than the trigger, so the clip collapsed the popover to an
            unclickable sliver. Unlike the Files listing, these rows DO carry `hover:bg-hover`,
            so the corners the clip used to round are restored explicitly on the first/last
            row. The Past list below keeps its clip — it renders no Menu (AddToCalendar is
            `upcoming`-gated), and its rows have the same hover fill to contain. */}
        {upcoming.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Nothing booked"
            hint="Head to Booking to reserve an instrument — your upcoming reservations will live here."
            action={<Link href="/booking" className="text-sm font-medium text-[var(--text-accent)] hover:underline">Browse equipment →</Link>} />
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface shadow-xs [&>li:first-child]:rounded-t-xl [&>li:last-child]:rounded-b-xl">{upcoming.map((b) => <Row key={b.id} b={b} upcoming onErr={setMsg} />)}</ul>
        )}
      </section>
      <section>
        <h2 className="font-medium text-default">Past &amp; closed</h2>
        {past.length === 0 ? (
          <EmptyState icon={Clock} title="No history yet" hint="Your past and closed bookings will collect here over time." />
        ) : (
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">{past.map((b) => <Row key={b.id} b={b} upcoming={false} onErr={setMsg} />)}</ul>
        )}
      </section>
    </div>
  )
}
