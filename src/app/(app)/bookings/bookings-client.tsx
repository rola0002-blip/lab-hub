'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { CalendarCheck, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { BOOKING_VARIANT } from '@/features/booking/chip'
import { AddToCalendar } from '@/components/calendar/add-to-calendar'
import { cancelMyBookingAction } from './actions'

type Item = {
  id: string; equipmentName: string; when: string; status: string; recurring: boolean; cancellable: boolean; reason: string | null
  startsAt: string; endsAt: string; purpose: string; location: string
}

// The destructive text actions were unpadded (~20px) and ringless. `whitespace-nowrap`
// keeps "Cancel series" from breaking mid-label once the row wraps on a phone.
const CANCEL_BTN = 'rounded px-1 py-1.5 whitespace-nowrap text-[var(--text-danger)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

function Row({ b, upcoming, onErr }: { b: Item; upcoming: boolean; onErr: (m: string) => void }) {
  const [pending, start] = useTransition()
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
      </span>
      <span className="flex flex-wrap items-center justify-end gap-2">
        {upcoming && ['CONFIRMED', 'PENDING'].includes(b.status) && (
          <AddToCalendar bookingId={b.id} summary={b.equipmentName} startsAt={b.startsAt} endsAt={b.endsAt} purpose={b.purpose} location={b.location} />
        )}
        <Badge variant={BOOKING_VARIANT[b.status as keyof typeof BOOKING_VARIANT]}>{b.status.toLowerCase()}</Badge>
        {b.cancellable && (
          <>
            <button type="button" disabled={pending} onClick={() => cancel('one')} className={CANCEL_BTN}>Cancel</button>
            {b.recurring && <button type="button" disabled={pending} onClick={() => cancel('future')} className={CANCEL_BTN}>Cancel series</button>}
          </>
        )}
      </span>
    </li>
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
