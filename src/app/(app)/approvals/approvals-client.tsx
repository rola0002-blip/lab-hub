'use client'
import { useState, useTransition } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { toast } from '@/components/ui/toast'
import { refreshNavCounts } from '@/lib/nav-counts-store'
import { approveAction, rejectAction, approveRuleAction, rejectRuleAction } from './actions'

export type ApprovalItem = {
  id: string; recurrenceRuleId: string | null
  requester: string; requesterRole: string; certified: boolean
  equipmentName: string; purpose: string; when: string
}

export type RecurringItem = { ruleId: string; count: number; first: ApprovalItem }

export default function ApprovalsClient({ items, recurring }: { items: ApprovalItem[]; recurring: RecurringItem[] }) {
  const [pending, start] = useTransition()
  const [rejecting, setRejecting] = useState<string | null>(null)
  // Reasons are per-row: one shared string let a reason drafted for request A ride
  // along with request B's rejection, and any successful reject wiped every other
  // row's draft. Keyed by booking id (singles) / rule id (recurring); entries for
  // decided rows just fall out of the queue with the row itself.
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const reasonFor = (id: string) => reasons[id] ?? ''
  const setReasonFor = (id: string, v: string) => setReasons((prev) => ({ ...prev, [id]: v }))

  // Approvals have no inline retry affordance, so a failed decision surfaces a
  // blameless toast whose Retry re-runs the exact same action (reason captured in
  // the closure). On a successful reject we close + clear the reason box; on
  // failure we keep it open so the reviewer can adjust and try again. Every
  // successful decision refreshes the sidebar Approvals badge (W20-D): revalidatePath
  // re-renders this page, but the badge is a CLIENT store the refresh never touches.
  const approve = (id: string) => start(async () => {
    const r = await approveAction(id)
    if (!r.ok) { toast(r.message ?? "We couldn't approve this request.", { action: { label: 'Retry', onClick: () => approve(id) } }); return }
    void refreshNavCounts() // W20-D: the badge drops with the card
  })
  const reject = (id: string, why: string) => start(async () => {
    const r = await rejectAction(id, why)
    if (!r.ok) { toast(r.message ?? "We couldn't reject this request.", { action: { label: 'Retry', onClick: () => reject(id, why) } }); return }
    setRejecting(null); setReasonFor(id, '')
    void refreshNavCounts()
  })
  const approveRule = (ruleId: string) => start(async () => {
    const x = await approveRuleAction(ruleId)
    if (!x.ok) { toast(x.message ?? "We couldn't approve the series.", { action: { label: 'Retry', onClick: () => approveRule(ruleId) } }); return }
    void refreshNavCounts()
  })
  const rejectRule = (ruleId: string, why: string) => start(async () => {
    const x = await rejectRuleAction(ruleId, why)
    if (!x.ok) { toast(x.message ?? "We couldn't reject the series.", { action: { label: 'Retry', onClick: () => rejectRule(ruleId, why) } }); return }
    setRejecting(null); setReasonFor(ruleId, '')
    void refreshNavCounts()
  })

  if (items.length === 0 && recurring.length === 0) {
    return <EmptyState icon={ClipboardCheck} title="Nothing waiting on you"
      hint="New booking requests that need approval will appear here." />
  }

  return (
    <ul className="mt-6 space-y-3">
      {recurring.map((r) => (
        <li key={r.ruleId} className="rounded-xl border-2 border-accent/40 bg-surface p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-default">{r.first.equipmentName} · recurring ×{r.count}</p>
              <p className="text-sm text-muted">First: {r.first.when} — requested by {r.first.requester}</p>
              <p className="text-xs text-subtle">One decision covers all {r.count} occurrences.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={pending} onClick={() => approveRule(r.ruleId)}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">Approve all</button>
              <button disabled={pending} onClick={() => setRejecting(rejecting === r.ruleId ? null : r.ruleId)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-default transition-colors hover:bg-hover">Reject…</button>
            </div>
          </div>
          {rejecting === r.ruleId && (
            <div className="mt-3 flex flex-wrap gap-2">
              {/* placeholder-only was the whole accessible name; `min-w-40` keeps the field
                  usable once the Confirm button wraps beside it on a narrow row. */}
              <input value={reasonFor(r.ruleId)} onChange={(e) => setReasonFor(r.ruleId, e.target.value)} placeholder="Reason (required)" aria-label="Rejection reason"
                className="min-w-40 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm" />
              <button disabled={pending || !reasonFor(r.ruleId).trim()} onClick={() => rejectRule(r.ruleId, reasonFor(r.ruleId))}
                className="rounded-md bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">Confirm reject</button>
            </div>
          )}
        </li>
      ))}
      {items.map((i) => (
        <li key={i.id} className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-default">{i.equipmentName} · {i.when}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                {i.requester} <span className="rounded-full bg-active px-2 py-0.5 text-xs uppercase text-muted">{i.requesterRole}</span>{' '}
                <Badge variant={i.certified ? 'success' : 'warning'}>{i.certified ? 'certified' : 'not certified'}</Badge>
              </p>
              {i.purpose && <p className="mt-1 text-sm text-muted">“{i.purpose}”</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={pending} onClick={() => approve(i.id)}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50">Approve</button>
              <button disabled={pending} onClick={() => setRejecting(rejecting === i.id ? null : i.id)}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-default transition-colors hover:bg-hover">Reject…</button>
            </div>
          </div>
          {rejecting === i.id && (
            <div className="mt-3 flex flex-wrap gap-2">
              <input value={reasonFor(i.id)} onChange={(e) => setReasonFor(i.id, e.target.value)} placeholder="Reason (required, shown to requester)" aria-label="Rejection reason"
                className="min-w-40 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm" />
              <button disabled={pending || !reasonFor(i.id).trim()} onClick={() => reject(i.id, reasonFor(i.id))}
                className="rounded-md bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">Confirm reject</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
