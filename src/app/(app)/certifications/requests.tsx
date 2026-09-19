'use client'
import { useState, useTransition } from 'react'
import { GraduationCap } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { decideTrainingRequestAction } from './actions'

export type RequestRowView = {
  id: string; userName: string; equipmentName: string
  note: string | null; requestedOn: string
}

// v0.32 Task 7: the Certifications → Requests tab. Grant reuses the matrix grant
// flow's shape (training date defaulting to today); the trainer is the decider —
// decideTrainingRequest routes grantCertification's trainedById there, so the row
// states it instead of offering a select that could not be honored. Decline is the
// approvals-queue posture: per-row reason state, never one shared box.
export default function Requests({ rows, today, me }: { rows: RequestRowView[]; today: string; me: { name: string } }) {
  const [pending, start] = useTransition()
  const [grant, setGrant] = useState<RequestRowView | null>(null)
  const [grantDate, setGrantDate] = useState('')
  const [declining, setDeclining] = useState<string | null>(null)
  // Per-row reasons keyed by request id (the v0.31.1 approvals fix): a reason
  // drafted for row A can never ride along with row B's decline, and a successful
  // decline clears only its own draft.
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const reasonFor = (id: string) => reasons[id] ?? ''
  const setReasonFor = (id: string, v: string) => setReasons((prev) => ({ ...prev, [id]: v }))

  function openGrant(row: RequestRowView) {
    setGrantDate(today)
    setGrant(row)
  }

  function confirmGrant() {
    if (!grant) return
    const row = grant
    start(async () => {
      const r = await decideTrainingRequestAction(row.id, 'grant', undefined, grantDate)
      if (!r.ok) { toast(r.message ?? "We couldn't grant this request."); return }
      setGrant(null)
    })
  }

  function decline(id: string, why: string) {
    start(async () => {
      const r = await decideTrainingRequestAction(id, 'decline', why)
      if (!r.ok) { toast(r.message ?? "We couldn't decline this request."); return }
      setDeclining(null); setReasonFor(id, '')
    })
  }

  if (rows.length === 0) {
    return (
      <EmptyState icon={GraduationCap} title="No training requests"
        hint="When someone asks for training on an instrument you manage, the request waits here." />
    )
  }

  return (
    <>
      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface">
        {/* min-w-[38rem] (the history table idiom): five columns, so the wrapper pans
            at 375px instead of crushing the Note column. */}
        <table className="min-w-[38rem] w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-subtle">
              <th className="p-2">Requester</th><th className="p-2">Instrument</th>
              <th className="p-2">Note</th><th className="p-2">Requested</th><th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap p-2 text-default">{r.userName}</td>
                <td className="whitespace-nowrap p-2 text-default">{r.equipmentName}</td>
                <td className="p-2 text-muted">{r.note}</td>
                <td className="whitespace-nowrap p-2 text-muted">{r.requestedOn}</td>
                <td className="p-2 text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" disabled={pending} onClick={() => openGrant(r)}
                      className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Grant</button>
                    <button type="button" disabled={pending} onClick={() => setDeclining(declining === r.id ? null : r.id)}
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-default transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Decline…</button>
                  </div>
                  {declining === r.id && (
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <input value={reasonFor(r.id)} onChange={(e) => setReasonFor(r.id, e.target.value)}
                        placeholder="Reason (required, shown to requester)" aria-label="Decline reason"
                        className="min-w-40 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
                      <button type="button" disabled={pending || !reasonFor(r.id).trim()} onClick={() => decline(r.id, reasonFor(r.id))}
                        className="rounded-md bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Confirm decline</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {grant && (
        <Modal title={`Grant training — ${grant.userName} on ${grant.equipmentName}`} onClose={() => setGrant(null)}>
          <p className="mt-2 text-sm text-muted">Grants the certification and records a training dated as entered. {grant.userName} is notified.</p>
          <label className="mt-3 block text-sm text-default">Training date
            <input type="date" value={grantDate} onChange={(e) => { if (e.target.value) setGrantDate(e.target.value) }}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
          </label>
          {/* decideTrainingRequest records the decider as the trainer (its grant path
              delegates to grantCertification with trainedById = the decider), so the
              flow states the trainer instead of offering a select it cannot honor. */}
          <p className="mt-3 text-sm text-muted">Trainer: <span className="text-default">{me.name} (you)</span></p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setGrant(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
            <button type="button" disabled={pending || !grantDate} onClick={confirmGrant}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Grant</button>
          </div>
        </Modal>
      )}
    </>
  )
}
