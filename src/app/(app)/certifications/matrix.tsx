'use client'
import { useTransition, useState } from 'react'
import { Award } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Modal } from '@/components/ui/modal'
import { grantCertAction, revokeCertAction } from './actions'

type Props = {
  users: Array<{ id: string; name: string; role: string }>
  equipment: Array<{ id: string; name: string }>
  certs: Array<{ userId: string; equipmentId: string }>
  editable: string[]
  today: string
  trainers: Array<{ id: string; name: string }>
  me: { id: string; name: string }
  lastTrained: Record<string, string>
}

type Grant = { user: { id: string; name: string }; equipment: { id: string; name: string }; date: string; trainerId: string; note: string }

export default function Matrix({ users, equipment, certs, editable, today, trainers, me, lastTrained }: Props) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [grant, setGrant] = useState<Grant | null>(null)
  const [grantError, setGrantError] = useState<string | null>(null)
  const has = (u: string, e: string) => certs.some((c) => c.userId === u && c.equipmentId === e)

  if (equipment.length === 0) {
    return <EmptyState icon={Award} title="No instruments to certify"
      hint="Once an admin adds active equipment, grant people access to it here." />
  }

  return (
    <>
      {/* A BOUNDED scroller (both axes): sticky only resolves against a scrollport, so the
          capped height is what makes the header row real — without it the page scrolls and
          `top-0` never engages. Safe here because this subtree renders no <Menu>: menu.tsx
          treats every clipping ancestor as a hard popover bound (files-client.tsx:176-182). */}
      <div className="mt-6 max-h-[80dvh] overflow-auto rounded-xl border border-border bg-surface shadow-xs">
        {msg && <p className="p-2 text-sm text-[var(--text-danger)]">{msg}</p>}
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-40 border-b border-border bg-surface p-2 text-left font-medium text-default">Person</th>
              {equipment.map((e) => <th key={e.id} className="sticky top-0 z-20 border-b border-border bg-surface p-2 text-left font-medium text-default">{e.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="group transition-colors hover:bg-hover">
                {/* The frozen name column paints its own background (a sticky cell would
                    otherwise let the scrolled checkboxes show through), so the row hover
                    has to be re-applied here from the row's `group`. */}
                <td className="sticky left-0 z-10 whitespace-nowrap border-b border-border bg-surface p-2 text-default transition-colors group-hover:bg-hover">{u.name} <span className="text-xs text-subtle">{u.role}</span></td>
                {equipment.map((e) => (
                  <td key={e.id} className="border-b border-border p-2">
                    {/* The <label> is the ≥24px tap target; the input keeps its own
                        aria-label, so the cell has an accessible name of its own rather
                        than relying on the (visually distant) column header. */}
                    <label className="flex min-h-6 min-w-6 cursor-pointer items-center justify-center p-1">
                      {/* CONTROLLED on purpose: checking a cell opens the Record-training
                          dialog but does NOT flip the box — only the revalidated props do,
                          once grantCertAction runs and revalidatePath re-renders. That is
                          not optimistic, so e2e dispatches a plain click and polls
                          toBeChecked() until the server round-trip lands. */}
                      <input type="checkbox" aria-label={`${u.name} — ${e.name}`}
                        title={lastTrained[`${u.id}:${e.id}`] ? `Last trained ${lastTrained[`${u.id}:${e.id}`]}` : undefined}
                        checked={has(u.id, e.id)} disabled={pending || !editable.includes(e.id)}
                        onChange={(ev) => {
                          if (ev.target.checked) { setGrantError(null); setGrant({ user: u, equipment: e, date: today, trainerId: me.id, note: '' }) }
                          else start(async () => {
                            const r = await revokeCertAction(u.id, e.id)
                            setMsg(r.ok ? null : (r.message ?? 'Failed'))
                          })
                        }} />
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {grant && (
        <Modal title={`Record training — ${grant.user.name} on ${grant.equipment.name}`} onClose={() => setGrant(null)}>
          <label className="mt-2 block text-sm text-default">Training date
            <input type="date" value={grant.date}
              onChange={(e) => setGrant({ ...grant, date: e.target.value })}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
          </label>
          <label className="mt-3 block text-sm text-default">Trainer
            <select value={grant.trainerId}
              onChange={(e) => setGrant({ ...grant, trainerId: e.target.value })}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
              {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm text-default">Notes <span className="text-subtle">(optional)</span>
            <textarea rows={3} maxLength={500} value={grant.note}
              onChange={(e) => setGrant({ ...grant, note: e.target.value })}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
          </label>
          {grantError && <p role="alert" className="mt-2 text-sm text-[var(--text-danger)]">{grantError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setGrant(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
            <button type="button" disabled={pending || !grant.date}
              onClick={() => start(async () => {
                const r = await grantCertAction(grant.user.id, grant.equipment.id, grant.trainerId, grant.date, grant.note)
                if (r.ok) setGrant(null); else setGrantError(r.message ?? 'Failed')
              })}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Save</button>
          </div>
        </Modal>
      )}
    </>
  )
}
