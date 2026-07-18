// Pure due-date helpers shared by the issue list/board due chips (DueDate), the
// overdue bot nudge (src/lib/jobs.ts), and the due-date quick filters (listIssues).
// NO 'server-only' — the display helpers are imported by client components too.
//
// All "today"/"this week" math is done in the ORG timezone so it agrees with
// formatDay's rendering (src/lib/time.ts) and is deterministic. Due dates are
// day-granular (the composer's <input type=date> stores UTC-midnight of the chosen
// day), so buckets compare calendar DAYS in the org zone: a due date "today" reads
// as due-today (amber), not overdue (red), and only flips to overdue once its whole
// day has passed. Display, nudge, and filter all share this one definition.
import { TZDate } from '@date-fns/tz'
import { format, startOfDay, endOfWeek } from 'date-fns'
import type { IssueStatus } from '@prisma/client'
import { isDoneLike } from './status'

export type DueBucket = 'overdue' | 'today' | 'upcoming'
export type DueFilter = 'overdue' | 'week'

// yyyy-MM-dd of `now` in the org timezone — the reference "today". The pages
// compute it once on the server and thread it into the rows/cards as a prop so SSR
// and client hydration bucket against the SAME day (no midnight-straddle mismatch).
export function orgToday(now: Date, tz: string): string {
  return format(new TZDate(now, tz), 'yyyy-MM-dd')
}

// Display bucket for a list row / board card. Completed work (DONE/CANCELED) is
// never flagged and a missing due date has no bucket → null. Day-granular compare
// in the org zone: dueDay < today ⇒ overdue, dueDay === today ⇒ today, else upcoming.
export function dueBucket(dueDate: Date | string | null, status: IssueStatus, today: string, tz: string): DueBucket | null {
  if (!dueDate || isDoneLike(status)) return null
  const dueDay = format(new TZDate(new Date(dueDate), tz), 'yyyy-MM-dd')
  if (dueDay < today) return 'overdue'
  if (dueDay === today) return 'today'
  return 'upcoming'
}

// UTC instant of 00:00 (org tz) on `now`'s day — the boundary the overdue nudge and
// the "overdue" quick filter compare against: dueDate < startOfOrgDay ⇒ the due DAY
// is fully past, matching dueBucket's 'overdue' (never flags something due today).
export function startOfOrgDay(now: Date, tz: string): Date {
  return new Date(startOfDay(new TZDate(now, tz)).getTime())
}

// UTC instant of the end of `now`'s week (Sunday 23:59:59.999, org tz; week starts
// Monday) — the upper bound of the "due this week" quick filter.
export function endOfOrgWeek(now: Date, tz: string): Date {
  return new Date(endOfWeek(new TZDate(now, tz), { weekStartsOn: 1 }).getTime())
}

// Prisma `dueDate` predicate for a due quick-filter. A PURE date range over dueDate,
// orthogonal to status (like every other filter param), so it composes with the
// status select and never contradicts it:
//   - overdue: strictly before the start of today (the due day has passed)
//   - week:    start of today .. end of this week (upcoming, still inside the week)
export function dueRange(due: DueFilter, now: Date, tz: string): { lt: Date } | { gte: Date; lte: Date } {
  const start = startOfOrgDay(now, tz)
  return due === 'overdue' ? { lt: start } : { gte: start, lte: endOfOrgWeek(now, tz) }
}
