'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { CalendarCheck, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { BOOKING_VARIANT } from '@/features/booking/chip'
import { cancelMyBookingAction } from './actions'

type Item = { id: string; equipmentName: string; when: string; status: string; recurring: boolean; cancellable: boolean; reason: string | null }

function Row({ b, onErr }: { b: Item; onErr: (m: string) => void }) {
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
      <span className="flex items-center gap-2">
        <Badge variant={BOOKING_VARIANT[b.status as keyof typeof BOOKING_VARIANT]}>{b.status.toLowerCase()}</Badge>
        {b.cancellable && (
          <>
            <button disabled={pending} onClick={() => cancel('one')} className="text-[var(--text-danger)] hover:underline">Cancel</button>
            {b.recurring && <button disabled={pending} onClick={() => cancel('future')} className="text-[var(--text-danger)] hover:underline">Cancel series</button>}
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
        {upcoming.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Nothing booked"
            hint="Head to Booking to reserve an instrument — your upcoming reservations will live here."
            action={<Link href="/booking" className="text-sm font-medium text-[var(--text-accent)] hover:underline">Browse equipment →</Link>} />
        ) : (
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">{upcoming.map((b) => <Row key={b.id} b={b} onErr={setMsg} />)}</ul>
        )}
      </section>
      <section>
        <h2 className="font-medium text-default">Past &amp; closed</h2>
        {past.length === 0 ? (
          <EmptyState icon={Clock} title="No history yet" hint="Your past and closed bookings will collect here over time." />
        ) : (
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">{past.map((b) => <Row key={b.id} b={b} onErr={setMsg} />)}</ul>
        )}
      </section>
    </div>
  )
}
