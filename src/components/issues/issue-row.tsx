'use client'
import Link from 'next/link'
import { useTransition } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Menu } from '@/components/ui/menu'
import { StatusIcon, PriorityIcon } from './status'
import { ISSUE_STATUSES, STATUS_LABEL, PRIORITIES, PRIORITY_LABEL, isDoneLike } from '@/features/issues/status'
import { setStatusAction, setAssigneeAction, setPriorityAction } from '@/app/(app)/issues/actions'
import type { IssueDto } from '@/features/issues/issue-service'
import type { Role } from '@/lib/session'

type Opt = { id: string; name: string; image?: string | null }
export function IssueRow({ issue, role, users, tabIndex, onFocusIndex }: {
  issue: IssueDto; role: Role; users: Opt[]; tabIndex: number; onFocusIndex: () => void
}) {
  const [, start] = useTransition()
  const canEdit = role !== 'guest'
  return (
    <div
      role="listitem" tabIndex={tabIndex} onFocus={onFocusIndex}
      className="group grid grid-cols-[auto_auto_1fr_auto_auto_auto_auto] items-center gap-3 px-3 py-1.5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring-focus)]"
    >
      {canEdit ? (
        <Menu label={`Priority: ${PRIORITY_LABEL[issue.priority]}`} button={<PriorityIcon priority={issue.priority} />}
          items={PRIORITIES.map((p) => ({ label: PRIORITY_LABEL[p], onSelect: () => start(() => setPriorityAction(issue.id, p).then(() => {})) }))} />
      ) : <PriorityIcon priority={issue.priority} />}
      {canEdit ? (
        <Menu label={`Status: ${STATUS_LABEL[issue.status]}`} button={<StatusIcon status={issue.status} />}
          items={ISSUE_STATUSES.map((s) => ({ label: STATUS_LABEL[s], onSelect: () => start(() => setStatusAction(issue.id, s).then(() => {})) }))} />
      ) : <StatusIcon status={issue.status} />}
      <Link href={`/issues/${issue.identifier}`} className="flex min-w-0 items-center gap-2 text-sm text-default hover:underline">
        <span className="shrink-0 text-2xs tabular-nums text-subtle">{issue.identifier}</span>
        <span className={`truncate ${isDoneLike(issue.status) ? 'text-muted line-through' : ''}`}>{issue.title}</span>
      </Link>
      <span className="flex shrink-0 gap-1">
        {issue.labels.map((l) => (
          <span key={l.id} className="rounded-full px-1.5 py-0.5 text-2xs" style={{ color: `var(${l.color})`, background: `color-mix(in srgb, var(${l.color}) 14%, var(--bg-canvas))` }}>{l.name}</span>
        ))}
      </span>
      <span className="shrink-0 text-2xs text-subtle">{issue.project?.name ?? ''}</span>
      <span className="shrink-0 text-2xs tabular-nums text-subtle">{issue.dueDate ? new Date(issue.dueDate).toLocaleDateString() : ''}</span>
      {canEdit ? (
        <Menu label={issue.assignee ? `Assignee: ${issue.assignee.name}` : 'Unassigned'}
          button={issue.assignee ? <Avatar size={20} name={issue.assignee.name} id={issue.assignee.id} image={issue.assignee.image} /> : <Avatar size={20} name="?" id="unassigned" image={null} />}
          items={[{ label: 'Unassigned', onSelect: () => start(() => setAssigneeAction(issue.id, null).then(() => {})) }, ...users.map((u) => ({ label: u.name, onSelect: () => start(() => setAssigneeAction(issue.id, u.id).then(() => {})) }))]} />
      ) : (issue.assignee ? <Avatar size={20} name={issue.assignee.name} id={issue.assignee.id} image={issue.assignee.image} /> : <span className="w-5" />)}
    </div>
  )
}
