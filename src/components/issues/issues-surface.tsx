'use client'
import { IssueListView } from './issue-list-view'
import { BoardView } from './board-view'
import { ViewToggle, useIssueView } from './view-toggle'
import type { IssueDto } from '@/features/issues/issue-service'
import type { Role } from '@/lib/session'
type Opt = { id: string; name: string; image?: string | null }
export function IssuesSurface({ initial, role, users, timezone, closedGrouped = false, empty = null }: {
  initial: IssueDto[]; role: Role; users: Opt[]; timezone: string; closedGrouped?: boolean; empty?: React.ReactNode
}) {
  const [view] = useIssueView()
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><ViewToggle /></div>
      {initial.length === 0 ? <>{empty}</>
        : view === 'board'
          // Key the board on the server-truth signature so an external SSE update (a
          // remount with fresh data) reconciles the local optimistic state.
          ? <BoardView key={initial.map((i) => i.id + i.status + i.rank).join('|')} initial={initial} role={role} />
          : <IssueListView issues={initial} role={role} users={users} timezone={timezone} closedGrouped={closedGrouped} empty={empty} />}
    </div>
  )
}
