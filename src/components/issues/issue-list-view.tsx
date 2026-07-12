'use client'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ISSUE_STATUSES, OPEN_STATUSES, STATUS_LABEL, isDoneLike } from '@/features/issues/status'
import { nextRovingIndex } from '@/lib/roving'
import { useEvents } from '@/components/use-events'
import { IssueRow } from './issue-row'
import { StatusIcon } from './status'
import type { IssueDto } from '@/features/issues/issue-service'
import type { IssueStatus } from '@prisma/client'
import type { Role } from '@/lib/session'

type Opt = { id: string; name: string; image?: string | null }
// Renders directly from the server-driven `issues` prop — no local copy — so a
// `router.refresh()` (SSE) or a server-action `revalidatePath` (inline picker)
// re-renders with fresh data. Only roving-focus index is local state.
export function IssueListView({ issues, role, users, closedGrouped = false, empty = null }: {
  issues: IssueDto[]; role: Role; users: Opt[]; closedGrouped?: boolean; empty?: React.ReactNode
}) {
  const router = useRouter()
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Any issue SSE event → refetch the current server-rendered view (URL carries filters).
  useEvents((e) => { if (e.t === 'issue' || e.t === 'issue_move' || e.t === 'issue_comment') router.refresh() })

  const groups = useMemo(() => {
    const order = closedGrouped ? [...OPEN_STATUSES] : ISSUE_STATUSES
    const rows: { key: string; label: string; status?: IssueStatus; items: IssueDto[] }[] = order.map((s) => ({
      key: s, label: STATUS_LABEL[s], status: s, items: issues.filter((i) => i.status === s),
    }))
    if (closedGrouped) rows.push({ key: 'closed', label: 'Closed', items: issues.filter((i) => isDoneLike(i.status)) })
    return rows.filter((g) => g.items.length > 0)
  }, [issues, closedGrouped])

  const flat = groups.flatMap((g) => g.items)
  // Named empty states are supplied by the page: no-issues / filter-empty (/issues,
  // /issues/me) and no-project-issues (project detail).
  if (flat.length === 0) return <>{empty}</>
  function onKeyDown(e: React.KeyboardEvent) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const idx = nextRovingIndex(active, flat.length, e.key as 'ArrowUp')
    setActive(idx < 0 ? 0 : idx)
    listRef.current?.querySelectorAll<HTMLElement>('[role=listitem]')[idx]?.focus()
  }

  // Flat roving index is a single sequence across all groups. Prefix-sum the
  // group sizes (pure — no render-time mutable counter, which the repo's
  // react-hooks/immutability rule rejects): `starts[gi] + j` is the row's
  // position in `flat`.
  const sizes = groups.map((g) => g.items.length)
  const starts = sizes.map((_, gi) => sizes.slice(0, gi).reduce((a, b) => a + b, 0))
  return (
    <div ref={listRef} role="list" aria-label="Issues" onKeyDown={onKeyDown} className="divide-y divide-border rounded-xl border border-border">
      {groups.map((g, gi) => (
        <div key={g.key}>
          <div className="flex items-center gap-2 bg-surface-sunken px-3 py-1.5 text-xs font-semibold text-muted">
            {g.status && <StatusIcon status={g.status} size={14} />}<span>{g.label}</span><span className="text-subtle">{g.items.length}</span>
          </div>
          {g.items.map((issue, j) => {
            const idx = starts[gi] + j
            return (
              <IssueRow key={issue.id} issue={issue} role={role} users={users} tabIndex={idx === active ? 0 : -1} onFocusIndex={() => setActive(idx)} />
            )
          })}
        </div>
      ))}
    </div>
  )
}
