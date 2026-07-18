import { dueBucket } from '@/features/issues/due'
import { formatDay } from '@/lib/time'
import type { IssueStatus } from '@prisma/client'

// Shared due-date chip for issue LIST rows and BOARD cards. Overdue reads red with
// the word "Overdue"; due-today reads amber with "Today"; anything else (an upcoming
// date, or a completed issue's date) renders the plain date in subtle text. Colours
// come from the semantic --text-overdue / --text-due-today tokens (globals.css, both
// themes, contrast-gated) — never a hardcoded hex. `today` is threaded from the server
// (org-zone yyyy-MM-dd) so SSR and hydration bucket identically. Returns null when
// there is no due date, so callers can render an empty grid cell or omit it entirely.
export function DueDate({ dueDate, status, today, timezone, className = '' }: {
  dueDate: string | null; status: IssueStatus; today: string; timezone: string; className?: string
}) {
  if (!dueDate) return null
  const day = formatDay(new Date(dueDate), timezone)
  const bucket = dueBucket(dueDate, status, today, timezone) // null for completed work
  if (bucket === 'overdue') {
    return <span className={`font-medium text-[var(--text-overdue)] ${className}`}>Overdue · {day}</span>
  }
  if (bucket === 'today') {
    return <span className={`font-medium text-[var(--text-due-today)] ${className}`}>Today · {day}</span>
  }
  return <span className={`text-subtle ${className}`}>{day}</span>
}
