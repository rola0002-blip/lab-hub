import { Circle, CircleDashed, CircleDot, CircleDotDashed, CircleCheck, CircleX, Minus, SignalLow, SignalMedium, SignalHigh, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { IssueStatus, IssuePriority } from '@prisma/client'
import { STATUS_TOKEN, STATUS_LABEL, PRIORITY_LABEL } from '@/features/issues/status'

const STATUS_GLYPH: Record<IssueStatus, LucideIcon> = {
  BACKLOG: CircleDashed, TODO: Circle, IN_PROGRESS: CircleDot, IN_REVIEW: CircleDotDashed, DONE: CircleCheck, CANCELED: CircleX,
}
// `decorative` drops the aria-label (and hides the glyph from AT) for contexts
// where adjacent text already names the status — e.g. the list/board group
// headers. There, an aria-labelled <svg> is an exposed graphics child, which is
// disallowed directly under the issues `role="list"` (aria-required-children).
export function StatusIcon({ status, size = 15, decorative = false }: { status: IssueStatus; size?: number; decorative?: boolean }) {
  const Icon = STATUS_GLYPH[status]
  return <Icon size={size} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : STATUS_LABEL[status]} style={{ color: `var(${STATUS_TOKEN[status]})` }} />
}

const PRIORITY_GLYPH: Record<IssuePriority, LucideIcon> = {
  NONE: Minus, LOW: SignalLow, MEDIUM: SignalMedium, HIGH: SignalHigh, URGENT: TriangleAlert,
}
export function PriorityIcon({ priority, size = 15 }: { priority: IssuePriority; size?: number }) {
  const Icon = PRIORITY_GLYPH[priority]
  return <Icon size={size} aria-label={PRIORITY_LABEL[priority]} className={priority === 'URGENT' ? 'text-[var(--text-danger)]' : 'text-muted'} />
}
