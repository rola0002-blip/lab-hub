'use client'
import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Paperclip } from 'lucide-react'
import { renderTokens } from '@/components/chat/message-item'
import type { RefData } from '@/components/chat/issue-ref-pill'
import { IssueMentionInput } from './issue-mention-input'
import { IssueTimeline } from './issue-timeline'
import { IssueComposer } from './issue-composer'
import { PropertiesPanel } from './properties-panel'
import { setTitleAction, updateDescriptionAction } from '@/app/(app)/issues/actions'
import { toast } from '@/lib/toast-store'
import { useEvents } from '@/components/use-events'
import type { IssueDto } from '@/features/issues/issue-service'
import type { TimelineEntry } from '@/features/issues/comment-service'
import type { Role } from '@/lib/session'

type Opt = { id: string; name: string; image?: string | null }
type Attachment = { id: string; path: string; name: string; mime: string; size: number }
export function IssueDetail({ issue, attachments, timeline, role, selfId, users, projects, labels, timezone, originChip, issueRefs = [] }: {
  issue: IssueDto; attachments: Attachment[]; timeline: TimelineEntry[]; role: Role; selfId: string
  users: Opt[]; projects: Opt[]; labels: { id: string; name: string; color: string }[]; timezone: string; originChip?: ReactNode
  // Server-resolved LAB-<n> refs from the description + all comment bodies; the
  // client builds the Map once (pure render) and threads it into renderTokens.
  issueRefs?: { number: number; identifier: string; title: string; status: IssueDto['status'] }[]
}) {
  const router = useRouter()
  const canEdit = role !== 'guest'
  const [title, setTitle] = useState(issue.title)
  const [descEditing, setDescEditing] = useState(false)
  const [desc, setDesc] = useState(issue.description)
  const [, start] = useTransition()
  const names = new Map(users.map((u) => [u.id, u.name]))
  const refsMap: Map<number, RefData> = new Map(issueRefs.map((r) => [r.number, r]))
  useEvents((e) => { if (e.t === 'issue' || e.t === 'issue_comment' || e.t === 'issue_move') router.refresh() })

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      {/* Panel FIRST in source so it stacks ABOVE the content below lg (§6.3);
          on lg the explicit order utilities put the content back in column 1. */}
      <div className="lg:order-2">
        <PropertiesPanel issue={issue} role={role} users={users} projects={projects} labels={labels} />
      </div>
      <div className="min-w-0 space-y-4 lg:order-1">
        <div>
          <span className="text-2xs tabular-nums text-subtle">{issue.identifier}</span>
          {canEdit ? (
            <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Issue title"
              onBlur={() => { if (title.trim() && title !== issue.title) start(() => setTitleAction(issue.id, title.trim()).then((r) => { if (!r.ok) { toast(r.message); setTitle(issue.title) } })) }}
              className="mt-0.5 w-full rounded-md bg-transparent text-2xl font-semibold text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
          ) : <h1 className="mt-0.5 text-2xl font-semibold text-default">{issue.title}</h1>}
          {originChip}
        </div>
        <div>
          {descEditing ? (
            <div>
              <IssueMentionInput value={desc} onChange={setDesc} users={users} rows={5} ariaLabel="Issue description" placeholder="Add a description…  @ to mention" />
              <div className="mt-1 flex gap-2 text-xs">
                {/* Exit edit mode only on success — a failed save keeps the editor open with the draft intact. */}
                <button onClick={() => start(() => updateDescriptionAction(issue.id, desc).then((r) => { if (r.ok) setDescEditing(false); else toast(r.message) }))} className="rounded bg-accent px-2 py-0.5 font-medium text-accent-on focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Save</button>
                <button onClick={() => { setDesc(issue.description); setDescEditing(false) }} className="rounded border border-border px-2 py-0.5 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={!canEdit} onClick={() => setDescEditing(true)} className="block w-full rounded-md p-2 text-left text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:hover:bg-transparent">
              {issue.description ? <span className="whitespace-pre-wrap break-words">{renderTokens(issue.description, names, selfId, refsMap)}</span> : <span className="text-subtle">{canEdit ? 'Add a description…' : 'No description.'}</span>}
            </button>
          )}
        </div>
        {attachments.length > 0 && (
          <div className="space-y-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">Attachments</h2>
            {attachments.map((a) => a.mime.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element -- uploads are served by our own route
              <img key={a.id} src={a.path} alt={a.name} className="max-h-64 rounded-lg border border-border" />
            ) : (
              <a key={a.id} href={a.path} target="_blank" rel="noreferrer" download={a.name}
                className="flex w-fit items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
                <Paperclip size={13} aria-hidden /><span className="max-w-xs truncate">{a.name}</span>
                <span className="text-subtle">{Math.max(1, Math.round(a.size / 1024))} KB</span>
              </a>
            ))}
          </div>
        )}
        <div className="border-t border-border pt-4">
          <IssueTimeline entries={timeline} selfId={selfId} role={role} names={names} timezone={timezone} refs={refsMap} />
          {canEdit && <div className="mt-3"><IssueComposer issueId={issue.id} users={users} /></div>}
        </div>
      </div>
    </div>
  )
}
