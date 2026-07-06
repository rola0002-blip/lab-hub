'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createMaintenanceAction } from './maintenance-actions'

export default function MaintenanceDialogButton({ equipmentId }: { equipmentId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Array<{ id: string; when: string; userName: string }>>([])
  const [form, setForm] = useState({ start: '', end: '', reason: '' })

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
      <button onClick={() => setOpen(true)} className="rounded-md border border-gray-300 px-2 py-1">Block downtime</button>
      {open && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Schedule maintenance</h2>
            <label className="block text-sm">From<input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
            <label className="block text-sm">To<input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
            <label className="block text-sm">Reason<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. heater replacement" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {conflicts.length > 0 && (
              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">These bookings will be CANCELLED and owners notified:</p>
                <ul className="ml-4 list-disc">{conflicts.map((c) => <li key={c.id}>{c.userName} — {c.when}</li>)}</ul>
                <button disabled={pending} onClick={() => submit(true)} className="mt-2 rounded-md bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">Confirm and cancel them</button>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">Close</button>
              {conflicts.length === 0 && (
                <button disabled={pending || !form.start || !form.end || !form.reason.trim()} onClick={() => submit(false)}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Schedule</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
