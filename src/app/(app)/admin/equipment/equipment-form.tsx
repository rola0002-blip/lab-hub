'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  action: (fd: FormData) => Promise<{ ok: boolean; message?: string }>
  users: Array<{ id: string; name: string }>
  initial?: {
    name: string; description: string; location: string; advanceBookingDays: number
    maxDurationMinutes: number; certificationRequired: boolean; approvalPolicy: string
    allowRecurring: boolean; managerIds: string[]
  }
}

export default function EquipmentForm({ action, users, initial }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const input = 'w-full rounded-md border border-border bg-surface px-3 py-2'

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
      <label className="flex items-center gap-2 text-sm"><input name="certificationRequired" type="checkbox" defaultChecked={initial?.certificationRequired} />Certification required to book</label>
      <label className="block text-sm">Approval required for
        <select name="approvalPolicy" defaultValue={initial?.approvalPolicy ?? 'GUESTS'} className={input}>
          <option value="NONE">No one (instant booking)</option>
          <option value="GUESTS">Guests only</option>
          <option value="ALL">Everyone</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm"><input name="allowRecurring" type="checkbox" defaultChecked={initial?.allowRecurring} />Allow recurring bookings (always need approval)</label>
      <label className="block text-sm">Equipment managers
        <select name="managers" multiple defaultValue={initial?.managerIds ?? []} className={`${input} h-28`}>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      {error && <p className="text-sm text-[var(--text-danger)]">{error}</p>}
      <button disabled={pending} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">{pending ? 'Saving…' : 'Save'}</button>
    </form>
  )
}
