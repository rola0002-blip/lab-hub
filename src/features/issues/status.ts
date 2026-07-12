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
