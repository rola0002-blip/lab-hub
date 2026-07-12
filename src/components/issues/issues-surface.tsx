'use client'
import { IssueListView } from './issue-list-view'
import { BoardView } from './board-view'
import { ViewToggle, useIssueView } from './view-toggle'
import { boardSignature } from '@/features/issues/board-signature'
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
          // remount with fresh data) reconciles the local optimistic state. The
          // signature includes each issue's updatedAt so a peer's non-position edit
          // (title/priority/assignee) also remounts the board — otherwise BoardView's
          // seeded useState keeps rendering the stale card (F1). Collapse state
          // survives the remount (board-collapse localStorage store).
          ? <BoardView key={boardSignature(initial)} initial={initial} role={role} />
          : <IssueListView issues={initial} role={role} users={users} timezone={timezone} closedGrouped={closedGrouped} empty={empty} />}
    </div>
  )
}
