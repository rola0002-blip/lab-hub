import { Circle, CircleDashed, CircleDot, CircleDotDashed, CircleCheck, CircleX, Minus, SignalLow, SignalMedium, SignalHigh, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { IssueStatus, IssuePriority } from '@prisma/client'
import { STATUS_TOKEN, STATUS_LABEL, PRIORITY_LABEL } from '@/features/issues/status'

const STATUS_GLYPH: Record<IssueStatus, LucideIcon> = {
  BACKLOG: CircleDashed, TODO: Circle, IN_PROGRESS: CircleDot, IN_REVIEW: CircleDotDashed, DONE: CircleCheck, CANCELED: CircleX,
}
export function StatusIcon({ status, size = 15 }: { status: IssueStatus; size?: number }) {
  const Icon = STATUS_GLYPH[status]
  return <Icon size={size} aria-label={STATUS_LABEL[status]} style={{ color: `var(${STATUS_TOKEN[status]})` }} />
}

const PRIORITY_GLYPH: Record<IssuePriority, LucideIcon> = {
  NONE: Minus, LOW: SignalLow, MEDIUM: SignalMedium, HIGH: SignalHigh, URGENT: TriangleAlert,
}
export function PriorityIcon({ priority, size = 15 }: { priority: IssuePriority; size?: number }) {
  const Icon = PRIORITY_GLYPH[priority]
  return <Icon size={size} aria-label={PRIORITY_LABEL[priority]} className={priority === 'URGENT' ? 'text-[var(--text-danger)]' : 'text-muted'} />
}
