import { Hourglass } from 'lucide-react'
import { isIssueStalled, daysSinceOrgDay } from '@/features/issues/stale'
import type { IssueStatus } from '@prisma/client'

// Muted stalled chip for list rows and board cards (spec §5.3, the due-date.tsx
// posture): returns null when not stalled — and when lastTouchedAt is absent
// (optimistic mutation results), the correct conservative transient. Already-gated
// tokens only (text-subtle + border-border): the wave's contrast delta stays the
// four --health-* entries. Shape + word, never colour-alone.
export function StalledChip({ status, lastTouchedAt, today, timezone, className = '' }: {
  status: IssueStatus; lastTouchedAt?: string; today: string; timezone: string; className?: string
}) {
  if (!isIssueStalled(status, lastTouchedAt ?? null, today, timezone)) return null
  const days = daysSinceOrgDay(lastTouchedAt!, today, timezone)
  const title = `No activity for ${days} days`
  return (
    <span title={title} aria-label={title}
      className={`inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-2xs text-subtle ${className}`}>
      <Hourglass size={11} aria-hidden />Stalled
    </span>
  )
}
