'use client'
import { useTransition } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { Menu } from '@/components/ui/menu'
import { StatusIcon, PriorityIcon } from './status'
import { ISSUE_STATUSES, STATUS_LABEL, isDoneLike } from '@/features/issues/status'
import { setStatusAction } from '@/app/(app)/issues/actions'
import type { IssueDto } from '@/features/issues/issue-service'

export function BoardCard({ issue, disabled }: { issue: IssueDto; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.id, disabled })
  const [, start] = useTransition()
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border border-border bg-surface p-2 shadow-xs ${isDragging ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-1.5">
        {!disabled && (
          <button {...attributes} {...listeners} aria-label={`Reorder ${issue.identifier}`} className="mt-0.5 cursor-grab text-subtle hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
            <GripVertical size={14} aria-hidden />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <Link href={`/issues/${issue.identifier}`} className="block text-2xs tabular-nums text-subtle hover:underline">{issue.identifier}</Link>
          <p className={`text-sm text-default ${isDoneLike(issue.status) ? 'line-through text-muted' : ''}`}>{issue.title}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <PriorityIcon priority={issue.priority} size={13} />
            {/* Non-drag status fallback: change status via a keyboard-accessible Menu, no DnD required. */}
            {disabled
              ? <StatusIcon status={issue.status} size={13} />
              : <Menu label={`Status: ${STATUS_LABEL[issue.status]}`} button={<StatusIcon status={issue.status} size={13} />}
                  items={ISSUE_STATUSES.map((s) => ({ label: STATUS_LABEL[s], onSelect: () => start(() => setStatusAction(issue.id, s).then(() => {})) }))} />}
            <span className="flex-1" />
            {issue.assignee && <Avatar size={20} name={issue.assignee.name} id={issue.assignee.id} image={issue.assignee.image} />}
          </div>
        </div>
      </div>
    </div>
  )
}
