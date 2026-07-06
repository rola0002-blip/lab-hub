'use client'
import { useState, useTransition } from 'react'
import { cancelMyBookingAction } from './actions'

type Item = { id: string; equipmentName: string; when: string; status: string; recurring: boolean; cancellable: boolean; reason: string | null }

const BADGE: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-800', PENDING: 'bg-amber-100 text-amber-800',
  REJECTED: 'bg-red-100 text-red-800', CANCELLED: 'bg-gray-200 text-gray-600', EXPIRED: 'bg-gray-200 text-gray-600',
}

function Row({ b, onErr }: { b: Item; onErr: (m: string) => void }) {
  const [pending, start] = useTransition()
  function cancel(scope: 'one' | 'future') {
    const q = scope === 'future' ? 'Cancel this and all future occurrences?' : 'Cancel this booking?'
    if (!confirm(q)) return
    start(async () => { const r = await cancelMyBookingAction(b.id, scope); if (!r.ok) onErr(r.message ?? 'Failed') })
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <span>
        <strong>{b.equipmentName}</strong> · {b.when}{b.recurring && ' · recurring'}
        {b.reason && <span className="block text-xs text-gray-500">Reason: {b.reason}</span>}
      </span>
      <span className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[b.status]}`}>{b.status.toLowerCase()}</span>
        {b.cancellable && (
          <>
            <button disabled={pending} onClick={() => cancel('one')} className="text-red-600 hover:underline">Cancel</button>
            {b.recurring && <button disabled={pending} onClick={() => cancel('future')} className="text-red-600 hover:underline">Cancel series</button>}
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
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <section>
        <h2 className="font-medium">Upcoming</h2>
        {upcoming.length === 0 ? <p className="mt-2 text-sm text-gray-500">Nothing booked. Head to Booking to reserve an instrument.</p> : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">{upcoming.map((b) => <Row key={b.id} b={b} onErr={setMsg} />)}</ul>
        )}
      </section>
      <section>
        <h2 className="font-medium">Past & closed</h2>
        {past.length === 0 ? <p className="mt-2 text-sm text-gray-500">No history yet.</p> : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">{past.map((b) => <Row key={b.id} b={b} onErr={setMsg} />)}</ul>
        )}
      </section>
    </div>
  )
}
