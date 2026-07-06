'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

type Props = {
  equipmentId: string; timezone: string; allowRecurring: boolean
  initialStart: Date; initialEnd: Date; onClose: () => void
}
type Verdict = { kind: 'instant' } | { kind: 'approval'; why: string } | { kind: 'blocked'; reason: string; message: string }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function BookingDialog({ equipmentId, timezone, allowRecurring, initialStart, initialEnd, onClose }: Props) {
  const router = useRouter()
  const [purpose, setPurpose] = useState('')
  const [recurring, setRecurring] = useState(false)
  const local = useMemo(() => new TZDate(initialStart, timezone), [initialStart, timezone])
  const [days, setDays] = useState<number[]>([local.getDay()])
  const [until, setUntil] = useState(format(new TZDate(new Date(+initialStart + 28 * 86_400_000), timezone), 'yyyy-MM-dd'))
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const durationMinutes = Math.round((+initialEnd - +initialStart) / 60_000)
  const startMinutes = local.getHours() * 60 + local.getMinutes()
  const firstDate = format(local, 'yyyy-MM-dd')

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await fetch('/api/bookings/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId, startsAt: initialStart, endsAt: initialEnd, purpose: '',
          ...(recurring ? { recurring: { daysOfWeek: days, startMinutes, durationMinutes, firstDate, untilDate: until } } : {}),
        }),
      })
      if (r.ok) setVerdict(await r.json())
    }, 300)
    return () => clearTimeout(t)
  }, [equipmentId, initialStart, initialEnd, recurring, days, until, startMinutes, durationMinutes, firstDate])

  async function submit() {
    setBusy(true); setError(null); setConflicts([])
    const r = await fetch('/api/bookings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipmentId, startsAt: initialStart, endsAt: initialEnd, purpose,
        ...(recurring ? { recurring: { daysOfWeek: days, startMinutes, durationMinutes, firstDate, untilDate: until } } : {}),
      }),
    })
    setBusy(false)
    const body = await r.json()
    if (r.ok) { onClose(); router.refresh(); return }
    if (body.error === 'conflicts') setConflicts(body.conflicts)
    else setError(body.message ?? 'Booking failed')
    if (r.status === 409 && body.error === 'slot_taken') router.refresh() // show the fresh calendar behind the dialog
  }

  const when = `${format(local, 'EEE d MMM, HH:mm')}–${format(new TZDate(initialEnd, timezone), 'HH:mm')}`

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Book this slot</h2>
        <p className="mt-1 text-sm text-gray-600">{when} ({(durationMinutes / 60).toFixed(1)} h)</p>

        <label className="mt-4 block text-sm">Purpose
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500}
            placeholder="e.g. hBN growth run" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
        </label>

        {allowRecurring && (
          <div className="mt-3 rounded-lg border border-gray-200 p-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />Repeat weekly (whole series needs approval)</label>
            {recurring && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((w, i) => (
                    <label key={w} className={`rounded-md border px-2 py-1 ${days.includes(i) ? 'border-accent bg-accent/10' : 'border-gray-200'}`}>
                      <input type="checkbox" className="hidden" checked={days.includes(i)}
                        onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((d) => d !== i))} />{w}
                    </label>
                  ))}
                </div>
                <label className="block">Until (inclusive)
                  <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1 rounded-md border border-gray-300 px-2 py-1" />
                </label>
              </div>
            )}
          </div>
        )}

        {verdict && (
          <p className={`mt-3 rounded-md p-2 text-sm ${verdict.kind === 'blocked' ? 'bg-red-50 text-red-700' : verdict.kind === 'approval' ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
            {verdict.kind === 'instant' && 'This booking will confirm instantly.'}
            {verdict.kind === 'approval' && (verdict.why === 'recurring' ? 'Recurring series — an equipment manager must approve it.' : verdict.why === 'guest_policy' ? 'Guests need approval on this instrument.' : 'This instrument requires approval for every booking.')}
            {verdict.kind === 'blocked' && verdict.message}
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {conflicts.length > 0 && (
          <div className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-700">
            <p>These occurrences clash — adjust the pattern:</p>
            <ul className="ml-4 list-disc">{conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
          <button disabled={busy || verdict?.kind === 'blocked' || (recurring && days.length === 0)} onClick={submit}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {busy ? 'Booking…' : verdict?.kind === 'approval' ? 'Request booking' : 'Book'}
          </button>
        </div>
      </div>
    </div>
  )
}
