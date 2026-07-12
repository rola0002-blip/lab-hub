'use client'
import { useState, useTransition } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { renderTokens } from '@/components/chat/message-item'
import type { RefData } from '@/components/chat/issue-ref-pill'
import { Avatar } from '@/components/ui/avatar'
import { Menu } from '@/components/ui/menu'
import { formatDateTime } from '@/lib/time'
import { STATUS_LABEL } from '@/features/issues/status'
import { editCommentAction, deleteCommentAction } from '@/app/(app)/issues/actions'
import { toast } from '@/lib/toast-store'
import type { TimelineEntry } from '@/features/issues/comment-service'
import type { Role } from '@/lib/session'

function activityText(type: string, data: unknown): string {
  const d = (data ?? {}) as Record<string, unknown>
  switch (type) {
    case 'created': return 'created the issue'
    case 'status': return `changed status to ${STATUS_LABEL[(d.to as keyof typeof STATUS_LABEL)] ?? String(d.to)}`
    case 'assignee': return d.to ? 'changed the assignee' : 'unassigned the issue'
    case 'priority': return `set priority to ${String(d.to).toLowerCase()}`
    case 'project': return d.to ? 'moved it to a project' : 'removed it from its project'
    case 'due_date': return d.to ? 'set a due date' : 'cleared the due date'
    case 'labels': return 'updated labels'
    case 'title': return 'renamed the issue'
    default: return type
  }
}

export function IssueTimeline({ entries, selfId, role, names, timezone, refs = null }: { entries: TimelineEntry[]; selfId: string; role: Role; names: Map<string, string>; timezone: string; refs?: Map<number, RefData> | null }) {
  const [, start] = useTransition()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  return (
    <ol className="space-y-3">
      {entries.map((e) => e.kind === 'activity' ? (
        <li key={e.id} className="flex items-center gap-2 pl-1 text-xs text-muted">
          <Avatar size={20} name={e.actor.name} id={e.actor.id} image={e.actor.image} />
          <span><span className="font-medium text-default">{e.actor.name}</span> {activityText(e.type, e.data)}</span>
          <time dateTime={e.createdAt} className="text-subtle">{formatDateTime(new Date(e.createdAt), timezone)}</time>
        </li>
      ) : (
        <li key={e.id} className="flex gap-2">
          <Avatar size={36} name={e.comment.author.name} id={e.comment.author.id} image={e.comment.author.image} />
          <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface p-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-default">{e.comment.author.name}</span>
              <time dateTime={e.comment.createdAt} className="text-xs text-muted">{formatDateTime(new Date(e.comment.createdAt), timezone)}</time>
              {e.comment.editedAt && <span className="text-2xs text-subtle">(edited)</span>}
              <span className="flex-1" />
              {!e.comment.deleted && (e.comment.author.id === selfId || role === 'admin') && (
                <Menu label="Comment actions" button={<MoreHorizontal size={15} aria-hidden />} items={[
                  ...(e.comment.author.id === selfId ? [{ label: 'Edit', onSelect: () => { setEditing(e.comment.id); setDraft(e.comment.body) } }] : []),
                  { label: 'Delete', danger: true, onSelect: () => start(() => deleteCommentAction(e.comment.id).then((r) => { if (!r.ok) toast(r.message) })) },
                ]} />
              )}
            </div>
            {e.comment.deleted ? <p className="text-sm italic text-subtle">comment deleted</p> : editing === e.comment.id ? (
              <div className="mt-1">
                <textarea value={draft} onChange={(ev) => setDraft(ev.target.value)} rows={2} className="w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
                <div className="mt-1 flex gap-2 text-xs">
                  {/* Exit edit mode only on success — a failed save keeps the editor open with the draft intact. */}
                  <button onClick={() => start(() => editCommentAction(e.comment.id, draft).then((r) => { if (r.ok) setEditing(null); else toast(r.message) }))} className="rounded bg-accent px-2 py-0.5 font-medium text-accent-on focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Save</button>
                  <button onClick={() => setEditing(null)} className="rounded border border-border px-2 py-0.5 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
                </div>
              </div>
            ) : <p className="whitespace-pre-wrap break-words text-sm text-default">{renderTokens(e.comment.body, names, selfId, refs)}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}
