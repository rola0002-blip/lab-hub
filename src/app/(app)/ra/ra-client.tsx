'use client'
import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/lib/toast-store'
import { formatDateTime } from '@/lib/time'
// TYPE-ONLY: ra-service.ts is `server-only`, so a value import here would fail
// the build. The DTO shape is all the client needs.
import type { RaAcknowledgmentDto } from '@/features/ra/ra-service'
import { submitRaAction, revokeRaAction } from './actions'

// The raOptions() return restated inline — same reason as the type-only import
// above: the service module must never be pulled into the client bundle.
type Options = {
  folderExists: boolean
  documents: { id: string; name: string }[]
  acknowledgedDocumentIds: string[]
}

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
const SMALL_BTN = `rounded-md border border-border px-2 py-1 text-xs hover:bg-hover active:bg-active ${RING}`
const REVOKE_BTN = `rounded text-xs text-[var(--text-danger)] hover:underline ${RING}`

export function RaClient({ name, options, mine, all, tz }: {
  name: string; options: Options; mine: RaAcknowledgmentDto[]; all?: RaAcknowledgmentDto[]; tz: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const raListId = useId()
  // Wave 19 bulk acknowledge: multi-tick Set (the files-client export idiom) —
  // ticks clear on success so a follow-up submit starts clean.
  const [ticks, setTicks] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setTicks((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const [matric, setMatric] = useState('')
  // v0.32 Task 11: the revoke confirm (was native confirm) — whose=null is the
  // self-serve arm ("your acknowledgment"), a name is the records-table arm.
  const [confirmRevoke, setConfirmRevoke] = useState<{ id: string; doc: string; whose: string | null } | null>(null)
  const acked = options.acknowledgedDocumentIds

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const m = matric.trim()
    if (ticks.size === 0 || !m) return
    start(async () => {
      const r = await submitRaAction([...ticks], m)
      // No optimistic state: rows land via router.refresh() (the Files posture);
      // ticks + matric clear so a follow-up submit starts clean.
      if (r.ok) {
        toast(r.recorded > 0
          ? `Acknowledged ${r.recorded} RA${r.recorded === 1 ? '' : 's'} — recorded.`
          : 'Already acknowledged — nothing to record.')
        setTicks(new Set()); setMatric(''); router.refresh()
      } else toast(r.message)
    })
  }

  // The files del() idiom: confirm, await, toast + refresh (no per-button
  // pending — the row leaving via router.refresh is the durable signal).
  async function revoke(id: string) {
    const r = await revokeRaAction(id)
    if (r.ok) { toast('Acknowledgment revoked.'); router.refresh() } else toast(r.message)
  }

  // No folder ⇒ nothing to acknowledge: one friendly empty state, no form (the
  // feedback-client early-return idiom — never stack a second icon block under
  // the page's own call to action).
  if (!options.folderExists) {
    return (
      <div className="mt-4">
        <EmptyState icon={ShieldCheck} title="No RA folder yet"
          hint="An admin creates a folder named exactly “RA” in Files and uploads the risk assessments." />
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-8">
      {options.documents.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No RA documents yet"
          hint="Upload risk assessments into the “RA” folder in Files." />
      ) : (
        <section>
          <h2 className="text-sm font-semibold text-muted">Record that you have read an RA</h2>
          <form onSubmit={submit} className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-default">Full name
                {/* read-only: the record must be bound to the signed-in account, so
                    the name is shown, never typed. */}
                <input readOnly aria-readonly="true" defaultValue={name}
                  className={`mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-muted ${RING}`} />
              </label>
              <label className="block text-sm text-default">Matriculation number
                <input value={matric} onChange={(e) => setMatric(e.target.value)} maxLength={32} inputMode="text"
                  className={`mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default ${RING}`} />
              </label>
            </div>
            <div className="block text-sm text-default">
              <p id={raListId} className="mb-1">Which RAs did you read?</p>
              <div role="group" aria-labelledby={raListId}
                className="mt-1 max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-border bg-surface p-1.5">
                {options.documents.map((d) => {
                  const done = acked.includes(d.id)
                  return (
                    <label key={d.id} className={`flex items-center gap-2 rounded px-1.5 py-1 transition-colors focus-within:ring-2 focus-within:ring-[var(--ring-focus)] ${done ? '' : 'cursor-pointer hover:bg-hover'}`}>
                      <input type="checkbox" checked={done || ticks.has(d.id)} disabled={done} onChange={() => toggle(d.id)}
                        className="h-4 w-4 shrink-0 rounded border-border accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
                      <span className={`min-w-0 flex-1 truncate ${done ? 'text-subtle' : 'text-default'}`}>{d.name}{done ? ' — acknowledged' : ''}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <button type="submit" disabled={ticks.size === 0 || !matric.trim() || pending}
              className={`inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50 ${RING}`}>
              I have read the selected RAs
            </button>
          </form>
        </section>
      )}
      <section>
        <h2 className="text-sm font-semibold text-muted">My acknowledgments</h2>
        {mine.length > 0 ? (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface shadow-xs">
            {mine.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-default">{m.documentName}</span>
                <span aria-hidden className="text-subtle">·</span>
                <span className="text-muted">{m.matricNumber}</span>
                <span aria-hidden className="text-subtle">·</span>
                <time dateTime={m.createdAt} className="text-subtle">{formatDateTime(new Date(m.createdAt), tz)}</time>
                <button type="button" onClick={() => setConfirmRevoke({ id: m.id, doc: m.documentName, whose: null })}
                  className={`ml-1 ${REVOKE_BTN}`}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : (
          // NOT an EmptyState — the form above is this page's point; a muted line
          // keeps the section quiet instead of a second icon block.
          <p className="mt-3 text-sm text-muted">You have not acknowledged any RA yet.</p>
        )}
      </section>
      {all !== undefined && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-muted">Records</h2>
            <a href="/api/ra/acknowledgments/csv" className={`${SMALL_BTN} text-default`}>Export CSV</a>
          </div>
          {all.length > 0 ? (
            // 375px: six columns cannot fit — the repo's scroll-container
            // idiom (booking day page, schedule-view) keeps the page width
            // stable while the table pans inside its own scrollbar.
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-subtle">
                    <th scope="col" className="px-2 py-1.5 font-medium">Name</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Email</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">Matric</th>
                    <th scope="col" className="px-2 py-1.5 font-medium">RA</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">When</th>
                    {/* aria-label, not an sr-only span: sr-only is absolutely
                        positioned with no positioned ancestor inside the
                        overflow-x-auto scroller, so its 1px box escapes the
                        clip and breaks the 375px no-horizontal-overflow
                        invariant (wave-10 physical pass). */}
                    <th scope="col" aria-label="Actions" className="px-2 py-1.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {all.map((r) => (
                    <tr key={r.id} className="transition-colors hover:bg-hover">
                      <td className="border-t border-border px-2 py-1.5 text-default">{r.author.name}</td>
                      <td className="border-t border-border px-2 py-1.5 text-muted">{r.author.email}</td>
                      <td className="border-t border-border px-2 py-1.5 text-muted">{r.matricNumber}</td>
                      <td className="border-t border-border px-2 py-1.5 text-default">{r.documentName}</td>
                      <td className="border-t border-border px-2 py-1.5 text-right text-subtle">
                        <time dateTime={r.createdAt}>{formatDateTime(new Date(r.createdAt), tz)}</time>
                      </td>
                      <td className="border-t border-border px-2 py-1.5">
                        <button type="button" onClick={() => setConfirmRevoke({ id: r.id, doc: r.documentName, whose: r.author.name })}
                          className={REVOKE_BTN}>
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
           ) : (
            <div className="mt-3">
              <EmptyState icon={ShieldCheck} title="No acknowledgments yet"
                hint="Records appear here as team members acknowledge RAs." />
            </div>
          )}
        </section>
      )}
      <ConfirmDialog open={confirmRevoke !== null} danger
        title={confirmRevoke
          ? confirmRevoke.whose
            ? `Revoke ${confirmRevoke.whose}'s acknowledgment of “${confirmRevoke.doc}”?`
            : `Revoke your acknowledgment of “${confirmRevoke.doc}”?`
          : ''}
        body={confirmRevoke?.whose ? 'This removes the record.' : 'You can acknowledge it again afterwards.'}
        confirmLabel="Revoke"
        onClose={() => setConfirmRevoke(null)}
        onConfirm={() => revoke((confirmRevoke ?? { id: '' }).id)} />
    </div>
  )
}
