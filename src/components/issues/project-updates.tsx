'use client'
import Link from 'next/link'
import { MessageSquareQuote } from 'lucide-react'
import { renderTokens } from '@/components/chat/render-tokens'
import { HealthChip } from './health-chip'
import { openProjectUpdateComposer } from '@/lib/project-update-composer-store'
import { formatDateTime } from '@/lib/time'
import type { ProjectUpdateDto } from '@/features/issues/project-update-service'
import type { RefData } from '@/components/chat/issue-ref-pill'
import type { Role } from '@/lib/session'

type Origin = { where: string; href: string | null }
type Opt = { id: string; name: string }

// Visible label of the origin backlink chip — identical whether the chip links
// (member) or not (non-member), so the two branches can never drift apart.
function OriginLabel({ where }: { where: string }) {
  return <span className="inline-flex items-center gap-1"><MessageSquareQuote size={13} aria-hidden />From a message in {where}</span>
}

// Reverse-chron updates list (spec §4.6). A CLIENT component because renderTokens
// is exported from a 'use client' module; the mention names and the resolved
// LAB-<n> refs are server-built and passed as plain arrays (the issue-detail
// idiom — Maps don't cross the RSC boundary, so the Maps are rebuilt here).
export function ProjectUpdates({ updates, users, issueRefs = [], origins, role, projectId, timezone }: {
  updates: ProjectUpdateDto[]
  users: Opt[]
  issueRefs?: (RefData & { number: number })[]
  // Membership-gated origin backlink per update id; absent when the update has no
  // source message (or the message was deleted — the FK is SetNull).
  origins: Record<string, Origin>
  role: Role; projectId: string; timezone: string
}) {
  const names = new Map(users.map((u) => [u.id, u.name]))
  const refsMap: Map<number, RefData> = new Map(issueRefs.map((r) => [r.number, r]))
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
            return (
              <li key={u.id} className="rounded-xl border border-border bg-surface p-3 shadow-xs">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {/* The row shows the health STORED on that update; staleness is a
                      project-level derivation (the header chip owns it), never a
                      property of a historical row — hence stale={false}. */}
                  <HealthChip health={u.health} stale={false} />
                  <span className="font-medium text-default">{u.author.name}</span>
                  {/* Org-timezone rule (src/lib/time.ts): fixed pattern + org zone,
                      never the ambient runtime TZ — no hydration drift. */}
                  <span>{formatDateTime(new Date(u.createdAt), timezone)}</span>
                </div>
                <div className="mt-1.5 whitespace-pre-wrap break-words text-sm text-default">{renderTokens(u.body, names, undefined, refsMap)}</div>
                {origin && (
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
    </section>
  )
}
