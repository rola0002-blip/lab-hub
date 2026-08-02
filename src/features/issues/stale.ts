// Pure staleness helpers — the single source of truth for the "stalled" chip, the
// stalled filter, the prompt digest's untouched count, and the project "No update"
// bucket. NO 'server-only' (chip components import it), beside due.ts and mirroring
// its day-granular org-zone comparison. "Touched" is defined by the CALLER as
// max(latest IssueActivity.createdAt, latest non-deleted IssueComment.createdAt) —
// never Issue.updatedAt, which rank-only moves and column rebalances bump (spec §5).
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import type { IssueStatus } from '@prisma/client'

export const STALE_ISSUE_DAYS = 14
// Three missed weekly prompts — the number is tied to the cadence, not configurable.
export const STALE_PROJECT_DAYS = 21

// The "started" statuses — the only ones staleness applies to (backlog/todo work has
// not begun, done/canceled work is finished). Exported so the weekly prompt job's
// SELECT (src/lib/jobs.ts) and this predicate can never drift apart.
export const STARTED_STATUSES: IssueStatus[] = ['IN_PROGRESS', 'IN_REVIEW']

// Whole org-calendar days between `then`'s org day and `today` (yyyy-MM-dd, org zone).
export function daysSinceOrgDay(then: Date | string, today: string, tz: string): number {
  const thenDay = format(new TZDate(new Date(then), tz), 'yyyy-MM-dd')
  return Math.round((Date.parse(today) - Date.parse(thenDay)) / 86_400_000)
}

// Stalled = started (IN_PROGRESS/IN_REVIEW) and untouched for >= STALE_ISSUE_DAYS.
// An absent lastTouchedAt (optimistic mutation results — spec §5.2) is NOT stalled.
export function isIssueStalled(status: IssueStatus, lastTouchedAt: Date | string | null | undefined, today: string, tz: string): boolean {
  if (!STARTED_STATUSES.includes(status) || !lastTouchedAt) return false
  return daysSinceOrgDay(lastTouchedAt, today, tz) >= STALE_ISSUE_DAYS
}

// A project with no update ever, or whose latest update is older than
// STALE_PROJECT_DAYS, is in the derived "No update" state (never stored).
export function isProjectUpdateStale(lastUpdateAt: Date | string | null, today: string, tz: string): boolean {
  if (!lastUpdateAt) return true
  return daysSinceOrgDay(lastUpdateAt, today, tz) >= STALE_PROJECT_DAYS
}
