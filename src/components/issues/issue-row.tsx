'use client'
import Link from 'next/link'
import { useTransition } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Menu } from '@/components/ui/menu'
import { StatusIcon, PriorityIcon } from './status'
import { ISSUE_STATUSES, STATUS_LABEL, PRIORITIES, PRIORITY_LABEL, isDoneLike, labelTextVar } from '@/features/issues/status'
import { setStatusAction, setAssigneeAction, setPriorityAction } from '@/app/(app)/issues/actions'
import { toast } from '@/lib/toast-store'
import { DueDate } from './due-date'
import { StalledChip } from './stalled-chip'
import type { IssueDto } from '@/features/issues/issue-service'
import type { Role } from '@/lib/session'

type Opt = { id: string; name: string; image?: string | null }
export function IssueRow({ issue, role, users, timezone, today, tabIndex, onFocusIndex }: {
  issue: IssueDto; role: Role; users: Opt[]; timezone: string; today: string; tabIndex: number; onFocusIndex: () => void
}) {
  const [, start] = useTransition()
  const canEdit = role !== 'guest'
  // Two lines below md, the unchanged 8-track grid at md+. The row itself stays the
  // focus target (role=listitem + tabIndex): issue-list-view.tsx:47 focuses
  // `[role=listitem]` by index, so wrapping the row in anything would break roving focus.
  return (
    <div
      role="listitem" tabIndex={tabIndex} onFocus={onFocusIndex}
      className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring-focus)] md:grid md:grid-cols-[auto_auto_1fr_auto_auto_auto_auto_auto] md:gap-3"
    >
      {canEdit ? (
        <Menu label={`Priority: ${PRIORITY_LABEL[issue.priority]}`} button={<PriorityIcon priority={issue.priority} />}
          items={PRIORITIES.map((p) => ({ label: PRIORITY_LABEL[p], onSelect: () => start(() => setPriorityAction(issue.id, p).then((r) => { if (!r.ok) toast(r.message) })) }))} />
      ) : <PriorityIcon priority={issue.priority} />}
      {canEdit ? (
        <Menu label={`Status: ${STATUS_LABEL[issue.status]}`} button={<StatusIcon status={issue.status} />}
          items={ISSUE_STATUSES.map((s) => ({ label: STATUS_LABEL[s], onSelect: () => start(() => setStatusAction(issue.id, s).then((r) => { if (!r.ok) toast(r.message) })) }))} />
      ) : <StatusIcon status={issue.status} />}
      <Link href={`/issues/${issue.identifier}`} className="flex min-w-0 flex-1 basis-0 items-center gap-2 text-sm text-default hover:underline">
        <span className="shrink-0 text-2xs tabular-nums text-subtle">{issue.identifier}</span>
        <span className={`truncate ${isDoneLike(issue.status) ? 'text-muted line-through' : ''}`}>{issue.title}</span>
      </Link>
      <span className="hidden shrink-0 gap-1 md:flex">
        {issue.labels.map((l) => (
          <span key={l.id} className="rounded-full px-1.5 py-0.5 text-2xs" style={{ color: `var(${labelTextVar(l.color)})`, background: `color-mix(in srgb, var(${l.color}) 14%, var(--bg-canvas))` }}>{l.name}</span>
        ))}
      </span>
      {/* Phone-only line break. `display:none` at md+, so it is NOT a grid item there and
          the 8-track count below is untouched; below md its 100% basis wraps everything
          after it (stalled chip + assignee) onto line 2. */}
      <span className="basis-full md:hidden" aria-hidden="true" />
      {/* Renders nothing (null) unless the issue is started and untouched for
          STALE_ISSUE_DAYS — and nothing at all after an optimistic mutation, where
          the client DTO carries no lastTouchedAt. Wrapped like the due cell below so
          the cell always exists: a bare null child would leave the 8th track empty on
          non-stalled rows, and its gutter still renders, nudging the avatar rail 12px. */}
      <span className="shrink-0">
        <StalledChip status={issue.status} lastTouchedAt={issue.lastTouchedAt} today={today} timezone={timezone} />
      </span>
      <span className="hidden shrink-0 text-2xs text-subtle md:inline">{issue.project?.name ?? ''}</span>
      {/* Org-timezone rule (src/lib/time.ts): fixed pattern + org zone, never the
          ambient runtime TZ/locale — deterministic, so server and client HTML
          match byte-for-byte (no hydration mismatch). `today` is likewise a
          server-threaded org-day string, so the overdue/today bucket is stable
          across hydration. Empty cell (null) when there is no due date. */}
      <span className="hidden shrink-0 text-2xs tabular-nums md:inline">
        <DueDate dueDate={issue.dueDate} status={issue.status} today={today} timezone={timezone} />
      </span>
      {/* One cell either way (Menu renders its own wrapper div, so this span keeps the
          track count at 8). `ml-auto` right-aligns it at the end of line 2 on a phone;
          in the grid the track is `auto`, so the reset is cosmetic. */}
      <span className="ml-auto flex items-center md:ml-0">
        {canEdit ? (
          <Menu label={issue.assignee ? `Assignee: ${issue.assignee.name}` : 'Unassigned'}
            button={issue.assignee ? <Avatar size={20} name={issue.assignee.name} id={issue.assignee.id} image={issue.assignee.image} /> : <Avatar size={20} name="?" id="unassigned" image={null} />}
            items={[{ label: 'Unassigned', onSelect: () => start(() => setAssigneeAction(issue.id, null).then((r) => { if (!r.ok) toast(r.message) })) }, ...users.map((u) => ({ label: u.name, onSelect: () => start(() => setAssigneeAction(issue.id, u.id).then((r) => { if (!r.ok) toast(r.message) })) }))]} />
        ) : (issue.assignee ? <Avatar size={20} name={issue.assignee.name} id={issue.assignee.id} image={issue.assignee.image} /> : <span className="w-5" />)}
      </span>
    </div>
  )
}
