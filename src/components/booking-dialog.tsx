'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { Modal } from '@/components/ui/modal'

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
      try {
        const r = await fetch('/api/bookings/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            equipmentId, startsAt: initialStart, endsAt: initialEnd, purpose: '',
            ...(recurring ? { recurring: { daysOfWeek: days, startMinutes, durationMinutes, firstDate, untilDate: until } } : {}),
          }),
        })
        if (r.ok) setVerdict(await r.json())
      } catch { /* preview is best-effort — keep the last verdict on network/parse failure */ }
    }, 300)
    return () => clearTimeout(t)
  }, [equipmentId, initialStart, initialEnd, recurring, days, until, startMinutes, durationMinutes, firstDate])

  async function submit() {
    setBusy(true); setError(null); setConflicts([])
    try {
      const r = await fetch('/api/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId, startsAt: initialStart, endsAt: initialEnd, purpose,
          ...(recurring ? { recurring: { daysOfWeek: days, startMinutes, durationMinutes, firstDate, untilDate: until } } : {}),
        }),
      })
      const body = await r.json() // may throw on a non-JSON 5xx — caught below
      if (r.ok) { onClose(); router.refresh(); return }
      if (body.error === 'conflicts') setConflicts(body.conflicts)
      else setError(body.message ?? 'Booking failed')
      if (r.status === 409 && body.error === 'slot_taken') router.refresh() // show the fresh calendar behind the dialog
    } catch {
      setError('Booking failed — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const when = `${format(local, 'EEE d MMM, HH:mm')}–${format(new TZDate(initialEnd, timezone), 'HH:mm')}`

  return (
    <Modal title="Book this slot" onClose={() => { if (!busy) onClose() }}>
        <p className="mt-1 text-sm text-muted">{when} ({(durationMinutes / 60).toFixed(1)} h)</p>

        <label className="mt-4 block text-sm text-default">Purpose
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500}
            placeholder="e.g. hBN growth run" className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2" />
        </label>

        {allowRecurring && (
          <div className="mt-3 rounded-lg border border-border p-3 text-sm text-default">
            <label className="flex items-center gap-2"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />Repeat weekly (whole series needs approval)</label>
            {recurring && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((w, i) => (
                    <label key={w} className={`cursor-pointer rounded-md border px-2 py-1 transition-colors ${days.includes(i) ? 'border-accent bg-accent/10 text-accent' : 'border-border hover:bg-hover'}`}>
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
            {verdict.kind === 'approval' && (verdict.why === 'recurring' ? 'Recurring series — an equipment manager must approve it.' : verdict.why === 'guest_policy' ? 'Guests need approval on this instrument.' : 'This instrument requires approval for every booking.')}
            {verdict.kind === 'blocked' && verdict.message}
          </p>
        )}
        {error && <p className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>}
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
    </Modal>
  )
}
