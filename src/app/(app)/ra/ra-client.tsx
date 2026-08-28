'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
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
  const [documentId, setDocumentId] = useState('')
  const [matric, setMatric] = useState('')
  const acked = options.acknowledgedDocumentIds

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const doc = documentId
    const m = matric.trim()
    if (!doc || !m) return
    start(async () => {
      const r = await submitRaAction(doc, m)
      // No optimistic state: the row lands via router.refresh() (the Files
      // posture). The select is cleared too — the acknowledged option comes
      // back disabled, and leaving it selected would strand the form on it.
      if (r.ok) { toast('Acknowledged — recorded.'); setDocumentId(''); setMatric(''); router.refresh() }
      else toast(r.message)
    })
  }

  // The files del() idiom: confirm, await, toast + refresh (no per-button
  // pending — the row leaving via router.refresh is the durable signal).
  async function revoke(id: string, doc: string, whose: string | null) {
    const q = whose
      ? `Revoke ${whose}'s acknowledgment of “${doc}”? This removes the record.`
      : `Revoke your acknowledgment of “${doc}”? You can acknowledge it again afterwards.`
    if (!confirm(q)) return
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
            <label className="block text-sm text-default">Which RA did you read?
              <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}
                className={`mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default ${RING}`}>
                <option value="">Select an RA…</option>
                {options.documents.map((d) => (
                  <option key={d.id} value={d.id} disabled={acked.includes(d.id)}>
                    {d.name}{acked.includes(d.id) ? ' — acknowledged' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={!documentId || !matric.trim() || pending}
              className={`inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50 ${RING}`}>
              I have read this RA
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
                <button type="button" onClick={() => revoke(m.id, m.documentName, null)}
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
                    <th scope="col" className="px-2 py-1.5 font-medium"><span className="sr-only">Actions</span></th>
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
                        <button type="button" onClick={() => revoke(r.id, r.documentName, r.author.name)}
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
    </div>
  )
}
