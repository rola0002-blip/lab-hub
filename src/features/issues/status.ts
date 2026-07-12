import type { IssueStatus, IssuePriority } from '@prisma/client'

export const ISSUE_STATUSES: IssueStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED']
export const OPEN_STATUSES: IssueStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW']
export const PRIORITIES: IssuePriority[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']

export const STATUS_LABEL: Record<IssueStatus, string> = {
  BACKLOG: 'Backlog', TODO: 'Todo', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review', DONE: 'Done', CANCELED: 'Canceled',
}
// CSS custom-property names (defined in globals.css §3c, both themes; contrast-gated).
export const STATUS_TOKEN: Record<IssueStatus, string> = {
  BACKLOG: '--status-backlog', TODO: '--status-todo', IN_PROGRESS: '--status-in-progress',
  IN_REVIEW: '--status-in-review', DONE: '--status-done', CANCELED: '--status-canceled',
}
export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  NONE: 'No priority', LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent',
}

// Fixed label color palette (spec §3.3: label colors come from the fixed
// status/label token palette). New labels cycle it: PALETTE[count % length].
export const LABEL_PALETTE: string[] = [
  '--status-in-progress', '--status-in-review', '--status-done',
  '--status-backlog', '--status-canceled', '--status-todo',
]

export function isDoneLike(s: IssueStatus): boolean {
  return s === 'DONE' || s === 'CANCELED'
}

// A label stores a --status-* token as its color (LABEL_PALETTE above). That hue is
// tuned to the 3:1 non-text glyph bar and reads below the 4.5:1 AA TEXT bar as chip
// text over the chip's 14% tint, so chip TEXT must use the parallel --label-* token
// (darker in light / lighter in dark; both themes gated at 4.5:1 in
// scripts/check-contrast.mjs). The tint background keeps the original --status- hue.
export function labelTextVar(color: string): string {
  return color.startsWith('--status-') ? color.replace('--status-', '--label-') : color
}

// Shareable-URL hardening: Next searchParams values are string | string[] |
// undefined, and enum params come from user-editable URLs. A typo'd/stale value
// (?status=foo) must degrade to "no filter", never reach Prisma's enum column
// (which throws → 500 error boundary). Enum params are validated against the
// fixed sets; id params pass through (unknown ids just match nothing), with
// empty strings and repeated (array) params normalized to undefined.
export type IssueFilterParams = {
  status?: IssueStatus; priority?: IssuePriority
  assignee?: string; project?: string; label?: string
}
export function parseIssueFilters(sp: Record<string, string | string[] | undefined>): IssueFilterParams {
  const one = (v: string | string[] | undefined): string | undefined =>
    typeof v === 'string' && v !== '' ? v : undefined
  const status = one(sp.status)
  const priority = one(sp.priority)
  return {
    status: status !== undefined && (ISSUE_STATUSES as string[]).includes(status) ? (status as IssueStatus) : undefined,
    priority: priority !== undefined && (PRIORITIES as string[]).includes(priority) ? (priority as IssuePriority) : undefined,
    assignee: one(sp.assignee), project: one(sp.project), label: one(sp.label),
  }
}
