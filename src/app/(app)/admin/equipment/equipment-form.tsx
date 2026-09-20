'use client'
import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  action: (fd: FormData) => Promise<{ ok: boolean; message?: string }>
  users: Array<{ id: string; name: string }>
  initial?: {
    name: string; description: string; location: string; advanceBookingDays: number
    maxDurationMinutes: number; certificationRequired: boolean; approvalPolicy: string
    allowRecurring: boolean; managerIds: string[]
    accessStartMinutes: number; accessEndMinutes: number
  }
}

// The window selects step by 30 minutes; the 24 h end (1439 = 23:59) is only
// reachable through the "24 hours" checkbox, which is what writes 0/1439.
const WINDOW_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30)
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const isFullDay = (start: number, end: number) => start === 0 && end >= 1439

export default function EquipmentForm({ action, users, initial }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  // 24 h is the schema default, so a fresh form opens checked; an edit opens
  // checked only when the stored window really is the full day.
  const [fullDay, setFullDay] = useState(() => isFullDay(initial?.accessStartMinutes ?? 0, initial?.accessEndMinutes ?? 1439))
  const [startMin, setStartMin] = useState(initial?.accessStartMinutes ?? 0)
  // 23:59 has no 30-minute option — clamp the select's display value to 23:30
  // (the hidden input still submits 1439 while the checkbox is on).
  const [endMin, setEndMin] = useState(() => Math.min(initial?.accessEndMinutes ?? 1410, 1410))
  const input = 'w-full rounded-md border border-border bg-surface px-3 py-2'
  const managersLabelId = useId()

  return (
    <form className="mt-6 max-w-lg space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        start(async () => {
          const r = await action(fd)
          if (!r.ok) setError(r.message ?? 'Failed')
          else router.push('/admin/equipment')
        })
      }}>
      <label className="block text-sm">Name<input name="name" required defaultValue={initial?.name} className={input} /></label>
      <label className="block text-sm">Description<textarea name="description" defaultValue={initial?.description} className={input} /></label>
      <label className="block text-sm">Location<input name="location" defaultValue={initial?.location} className={input} /></label>
      <label className="block text-sm">Photo (PNG/JPEG/WebP ≤ 2 MB)<input name="photo" type="file" accept="image/png,image/jpeg,image/webp" className={input} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">Advance window (days)<input name="advanceBookingDays" type="number" min={1} max={365} defaultValue={initial?.advanceBookingDays ?? 14} className={input} /></label>
        <label className="block text-sm">Max duration (minutes)<input name="maxDurationMinutes" type="number" min={15} max={1440} step={15} defaultValue={initial?.maxDurationMinutes ?? 480} className={input} /></label>
      </div>
      {/* The daily access window. The submitted values ride on hidden inputs so
          the checkbox state — not the disabled selects' DOM, which FormData
          omits — decides what reaches the server. */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">Bookable from
          <select value={startMin} disabled={fullDay} onChange={(e) => setStartMin(Number(e.target.value))} className={input}>
            {WINDOW_OPTIONS.map((m) => <option key={m} value={m}>{hm(m)}</option>)}
          </select>
        </label>
        <label className="block text-sm">Bookable until
          <select value={endMin} disabled={fullDay} onChange={(e) => setEndMin(Number(e.target.value))} className={input}>
            {WINDOW_OPTIONS.map((m) => <option key={m} value={m}>{hm(m)}</option>)}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fullDay} onChange={(e) => setFullDay(e.target.checked)} />24 hours</label>
      <input type="hidden" name="accessStartMinutes" value={fullDay ? 0 : startMin} />
      <input type="hidden" name="accessEndMinutes" value={fullDay ? 1439 : endMin} />
      <label className="flex items-center gap-2 text-sm"><input name="certificationRequired" type="checkbox" defaultChecked={initial?.certificationRequired} />Certification required to book</label>
      <label className="block text-sm">Approval required for
        <select name="approvalPolicy" defaultValue={initial?.approvalPolicy ?? 'GUESTS'} className={input}>
          <option value="NONE">No approval needed</option>
          <option value="GUESTS">Only guests need approval</option>
          <option value="ALL">Everyone needs approval</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm"><input name="allowRecurring" type="checkbox" defaultChecked={initial?.allowRecurring} />Allow recurring bookings</label>
      <div className="block text-sm">
        <p id={managersLabelId} className="mb-1">Equipment managers</p>
        <div role="group" aria-labelledby={managersLabelId} className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-border bg-surface p-1.5">
          {users.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-default transition-colors hover:bg-hover focus-within:ring-2 focus-within:ring-[var(--ring-focus)]">
              <input type="checkbox" name="managers" value={u.id} defaultChecked={initial?.managerIds?.includes(u.id)} className="accent-[var(--accent)]" />
              {u.name}
            </label>
          ))}
          {users.length === 0 && <p className="px-1.5 py-1 text-sm text-muted">No eligible members (guests are excluded)</p>}
        </div>
      </div>
      {error && <p className="text-sm text-[var(--text-danger)]">{error}</p>}
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">{pending ? 'Saving…' : 'Save'}</button>
    </form>
  )
}
