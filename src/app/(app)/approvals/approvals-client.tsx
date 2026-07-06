'use client'
import { useState, useTransition } from 'react'
import { approveAction, rejectAction, approveRuleAction, rejectRuleAction } from './actions'

export type ApprovalItem = {
  id: string; recurrenceRuleId: string | null
  requester: string; requesterRole: string; certified: boolean
  equipmentName: string; purpose: string; when: string
}

export type RecurringItem = { ruleId: string; count: number; first: ApprovalItem }

export default function ApprovalsClient({ items, recurring }: { items: ApprovalItem[]; recurring: RecurringItem[] }) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  if (items.length === 0 && recurring.length === 0) return <p className="mt-6 text-gray-600">Nothing pending. 🎉</p>

  return (
    <ul className="mt-6 space-y-3">
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {recurring.map((r) => (
        <li key={r.ruleId} className="rounded-xl border-2 border-accent/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{r.first.equipmentName} · recurring ×{r.count}</p>
              <p className="text-sm text-gray-600">First: {r.first.when} — requested by {r.first.requester}</p>
              <p className="text-xs text-gray-500">One decision covers all {r.count} occurrences.</p>
            </div>
            <div className="flex gap-2">
              <button disabled={pending} onClick={() => start(async () => { const x = await approveRuleAction(r.ruleId); if (!x.ok) setMsg(x.message ?? 'Failed') })}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Approve all</button>
              <button disabled={pending} onClick={() => setRejecting(rejecting === r.ruleId ? null : r.ruleId)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">Reject…</button>
            </div>
          </div>
          {rejecting === r.ruleId && (
            <div className="mt-3 flex gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)"
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
              <button disabled={pending || !reason.trim()}
                onClick={() => start(async () => { const x = await rejectRuleAction(r.ruleId, reason); if (!x.ok) setMsg(x.message ?? 'Failed'); setRejecting(null); setReason('') })}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Confirm reject</button>
            </div>
          )}
        </li>
      ))}
      {items.map((i) => (
        <li key={i.id} className="rounded-xl border border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{i.equipmentName} · {i.when}</p>
              <p className="text-sm text-gray-600">
                {i.requester} <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs uppercase">{i.requesterRole}</span>{' '}
                <span className={`rounded-full px-2 py-0.5 text-xs ${i.certified ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                  {i.certified ? 'certified' : 'not certified'}
                </span>
              </p>
              {i.purpose && <p className="mt-1 text-sm text-gray-500">“{i.purpose}”</p>}
            </div>
            <div className="flex gap-2">
              <button disabled={pending} onClick={() => start(async () => { const r = await approveAction(i.id); if (!r.ok) setMsg(r.message ?? 'Failed') })}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Approve</button>
              <button disabled={pending} onClick={() => setRejecting(rejecting === i.id ? null : i.id)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">Reject…</button>
            </div>
          </div>
          {rejecting === i.id && (
            <div className="mt-3 flex gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, shown to requester)"
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm" />
              <button disabled={pending || !reason.trim()}
                onClick={() => start(async () => { const r = await rejectAction(i.id, reason); if (!r.ok) setMsg(r.message ?? 'Failed'); setRejecting(null); setReason('') })}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Confirm reject</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
