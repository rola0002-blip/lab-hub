'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MessageSquareQuote, MoreHorizontal } from 'lucide-react'
import { renderTokens } from '@/components/chat/render-tokens'
import { Menu } from '@/components/ui/menu'
import { Modal } from '@/components/ui/modal'
import { HealthChip } from './health-chip'
import { openProjectUpdateComposer } from '@/lib/project-update-composer-store'
import { canDeleteProjectUpdate, canEditProjectUpdate } from '@/features/issues/issue-policy'
import { PROJECT_HEALTH_LABEL } from '@/features/issues/project-health'
import { deleteProjectUpdateAction, editProjectUpdateAction } from '@/app/(app)/issues/actions'
import { toast } from '@/lib/toast-store'
import { formatDateTime } from '@/lib/time'
import type { ProjectUpdateDto } from '@/features/issues/project-update-service'
import type { RefData } from '@/components/chat/issue-ref-pill'
import type { Role } from '@/lib/session'
import type { ProjectHealth } from '@prisma/client'

type Origin = { where: string; href: string | null }
type Opt = { id: string; name: string }

// The composer's option order (project-update-modal.tsx), best-to-worst, and its
// labels — one source, so the correction can never offer a health the post path
// cannot, or spell one differently.
const HEALTHS: ProjectHealth[] = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK']
// Mirrors the action's zod cap (and the service's trim/slice), the composer's rule.
const BODY_MAX = 4000
// project-composer.tsx's field classes verbatim; SELECT drops its `mt-1 w-full`
// because this one sits inline beside its label rather than stacked in a modal.
const FIELD = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
const SELECT = 'rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
const BTN = 'rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

// Visible label of the origin backlink chip — identical whether the chip links
// (member) or not (non-member), so the two branches can never drift apart.
function OriginLabel({ where }: { where: string }) {
  return <span className="inline-flex items-center gap-1"><MessageSquareQuote size={13} aria-hidden />From a message in {where}</span>
}

// Reverse-chron updates list (spec §4.6). A CLIENT component because renderTokens
// is exported from a 'use client' module; the mention names and the resolved
// LAB-<n> refs are server-built and passed as plain arrays (the issue-detail
// idiom — Maps don't cross the RSC boundary, so the Maps are rebuilt here).
export function ProjectUpdates({ updates, users, issueRefs = [], origins, role, selfId, projectId, timezone }: {
  updates: ProjectUpdateDto[]
  users: Opt[]
  issueRefs?: (RefData & { number: number })[]
  // Membership-gated origin backlink per update id; absent when the update has no
  // source message (or the message was deleted — the FK is SetNull).
  origins: Record<string, Origin>
  // v0.15 §6.4 — the viewer's id, the ONE input the row affordances need beyond
  // `role`: edit is author-only, delete is author-or-admin (issue-policy).
  role: Role; selfId: string; projectId: string; timezone: string
}) {
  const router = useRouter()
  const names = new Map(users.map((u) => [u.id, u.name]))
  const refsMap: Map<number, RefData> = new Map(issueRefs.map((r) => [r.number, r]))
  // One editor and one confirm at a time, keyed by update id (the comment-row
  // idiom in issue-timeline.tsx) — the draft seeds when Edit is chosen, so a
  // refresh landing new server rows never fights an open editor.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftHealth, setDraftHealth] = useState<ProjectHealth>('ON_TRACK')
  const [pending, start] = useTransition()

  // Updates have no SSE channel (the Files precedent) and `run()` does not
  // revalidate /projects/[id], so the server render is refreshed by hand: the
  // corrected row, the header health chip and "updated N days ago" all repaint
  // from one read rather than drifting apart.
  function save(id: string) {
    start(async () => {
      const r = await editProjectUpdateAction(id, { body: draft, health: draftHealth })
      // Exit edit mode only on success — a refused save keeps the editor open
      // with the draft intact (the comment-editor contract).
      if (r.ok) { setEditingId(null); router.refresh() }
      else toast(r.message)
    })
  }
  function del(id: string) {
    start(async () => {
      const r = await deleteProjectUpdateAction(id)
      setConfirmId(null)
      if (r.ok) router.refresh()
      else toast(r.message)
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-default">Updates</h2>
        {/* Guests are read-only (issue-policy is the real gate); hide the
            affordance so they never raise a modal that only 403s at submit. */}
        {role !== 'guest' && (
          <button type="button" onClick={() => openProjectUpdateComposer({ projectId })}
            className="rounded-md border border-border px-2.5 py-1 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
            Post update
          </button>
        )}
      </div>
      {updates.length === 0 ? (
        <p className="text-sm text-muted">No updates yet. The weekly one-liner — what moved, what stalled — is what makes this page worth opening on a Monday.</p>
      ) : (
        <ul className="space-y-3">
          {updates.map((u) => {
            const origin = origins[u.id]
            // Cosmetic gate only — the service asserts both again. The `role !==
            // 'guest'` term is NOT redundant: canDeleteProjectUpdate keeps the
            // comment-predicate shape (author-or-admin, no guest term) because
            // assertCanMutate bars guests upstream, so a member DEMOTED to guest
            // still satisfies it on their own row and would otherwise be shown a
            // button that can only 403 (the "Post update" button above, again).
            const canEdit = role !== 'guest' && canEditProjectUpdate(role, u.author.id, selfId)
            const canDelete = role !== 'guest' && canDeleteProjectUpdate(role, u.author.id, selfId)
            const items = [
              ...(canEdit ? [{ label: 'Edit', onSelect: () => { setEditingId(u.id); setDraft(u.body); setDraftHealth(u.health) } }] : []),
              ...(canDelete ? [{ label: 'Delete', danger: true, onSelect: () => setConfirmId(u.id) }] : []),
            ]
            return (
              <li key={u.id} className="rounded-xl border border-border bg-surface p-3 shadow-xs">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {/* The row shows the health STORED on that update; staleness is a
                      project-level derivation (the header chip owns it), never a
                      property of a historical row — hence stale={false}.
                      A tombstone keeps WHO and WHEN (the gap in the record is the
                      point) but never the RETRACTED health call: the row is still
                      in the feed, its judgement is not. */}
                  {!u.deleted && <HealthChip health={u.health} stale={false} />}
                  <span className="font-medium text-default">{u.author.name}</span>
                  {/* Org-timezone rule (src/lib/time.ts): fixed pattern + org zone,
                      never the ambient runtime TZ — no hydration drift. */}
                  <span>{formatDateTime(new Date(u.createdAt), timezone)}</span>
                  {u.editedAt && !u.deleted && <span className="text-subtle">(edited)</span>}
                  {!u.deleted && items.length > 0 && (
                    <div className="ml-auto"><Menu label="Update actions" button={<MoreHorizontal size={16} aria-hidden />} items={items} /></div>
                  )}
                </div>
                {u.deleted ? (
                  <p className="mt-1.5 italic text-subtle text-sm">update deleted</p>
                ) : editingId === u.id ? (
                  <div className="mt-1.5">
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} aria-label="Update" maxLength={BODY_MAX} className={FIELD} />
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {/* Label-wrapped, but the accessible name comes from
                          aria-label (the composer's Project select): a
                          getByLabel match would otherwise reach the options. */}
                      <label className="flex items-center gap-2 text-xs text-muted">Health
                        <select aria-label="Health" value={draftHealth} onChange={(e) => setDraftHealth(e.target.value as ProjectHealth)} className={SELECT}>
                          {HEALTHS.map((h) => <option key={h} value={h}>{PROJECT_HEALTH_LABEL[h]}</option>)}
                        </select>
                      </label>
                      <div className="ml-auto flex gap-2">
                        <button type="button" onClick={() => setEditingId(null)} className={BTN}>Cancel</button>
                        <button type="button" onClick={() => save(u.id)} disabled={pending}
                          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1.5 whitespace-pre-wrap break-words text-sm text-default">{renderTokens(u.body, names, undefined, refsMap)}</div>
                )}
                {/* Dropped with the body on a retraction: the chip would still
                    point at the message this update was captured from, which is
                    exactly the content the author withdrew. */}
                {origin && !u.deleted && (
                  <div className="mt-1 text-xs text-muted">
                    {/* Links back to chat only for current members; everyone else
                        sees the chip unlinked (never widens chat visibility). */}
                    {origin.href
                      ? <Link href={origin.href} className="rounded bg-active px-1.5 py-0.5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"><OriginLabel where={origin.where} /></Link>
                      : <span className="rounded bg-active px-1.5 py-0.5"><OriginLabel where={origin.where} /></span>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {confirmId && (
        <Modal title="Delete this update?" onClose={() => setConfirmId(null)}>
          <p className="text-sm text-muted">
            The text goes and the project stops counting this update towards its health, but the row stays in the
            feed as a visible <span className="font-semibold text-default">“update deleted”</span> placeholder — a
            retraction is part of the record, not a hole in it. Post a new update to correct the health call.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmId(null)} className={BTN}>Cancel</button>
            <button type="button" onClick={() => del(confirmId)} disabled={pending}
              className="rounded-md bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
              Delete update
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
