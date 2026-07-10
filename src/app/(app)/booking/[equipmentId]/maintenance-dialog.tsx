'use client'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createMaintenanceAction } from './maintenance-actions'

export default function MaintenanceDialogButton({ equipmentId }: { equipmentId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Array<{ id: string; when: string; userName: string }>>([])
  const [form, setForm] = useState({ start: '', end: '', reason: '' })

  // Escape closes the open dialog (matches the Close button / backdrop click).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function submit(confirmCancel: boolean) {
    start(async () => {
      setError(null)
      const r = await createMaintenanceAction(equipmentId, new Date(form.start).toISOString(), new Date(form.end).toISOString(), form.reason, confirmCancel)
      if (r.ok) { setOpen(false); setConflicts([]); router.refresh(); return }
      if (r.error === 'needs_confirmation') setConflicts(r.conflicts)
      else setError(r.error === 'forbidden' ? 'Only managers can schedule maintenance.' : 'Enter a valid time range and reason.')
    })
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md border border-border px-2 py-1 text-default transition-colors hover:bg-hover">Block downtime</button>
      {open && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md space-y-3 rounded-xl bg-surface p-6 text-default shadow-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-default">Schedule maintenance</h2>
            <label className="block text-sm">From<input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2" /></label>
            <label className="block text-sm">To<input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2" /></label>
            <label className="block text-sm">Reason<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. heater replacement" className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2" /></label>
            {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
            {conflicts.length > 0 && (
              <div className="rounded-md bg-[var(--color-warning)]/12 p-3 text-sm text-default">
                <p className="font-medium">These bookings will be CANCELLED and owners notified:</p>
                <ul className="ml-4 list-disc">{conflicts.map((c) => <li key={c.id}>{c.userName} — {c.when}</li>)}</ul>
                <button disabled={pending} onClick={() => submit(true)} className="mt-2 rounded-md bg-[var(--color-danger)] px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">Confirm and cancel them</button>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-sm text-default transition-colors hover:bg-hover">Close</button>
              {conflicts.length === 0 && (
                <button disabled={pending || !form.start || !form.end || !form.reason.trim()} onClick={() => submit(false)}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">Schedule</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
