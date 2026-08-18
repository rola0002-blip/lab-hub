'use client'
import { useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Paperclip } from 'lucide-react'
import { renderTokens } from '@/components/chat/render-tokens'
import type { RefData } from '@/components/chat/issue-ref-pill'
import { IssueMentionInput } from './issue-mention-input'
import { IssueTimeline } from './issue-timeline'
import { IssueComposer } from './issue-composer'
import { PropertiesPanel } from './properties-panel'
import { Menu } from '@/components/ui/menu'
import { Modal } from '@/components/ui/modal'
import { setTitleAction, updateDescriptionAction, deleteIssueAction } from '@/app/(app)/issues/actions'
import { canDeleteIssue } from '@/features/issues/issue-policy'
import { toast } from '@/lib/toast-store'
import { useEvents } from '@/components/use-events'
import { isIssueRefetchEvent } from '@/features/issues/issue-events'
import type { IssueDto, LabelDto } from '@/features/issues/issue-service'
import type { TimelineEntry } from '@/features/issues/comment-service'
import type { Role } from '@/lib/session'

type Opt = { id: string; name: string; image?: string | null }
type Attachment = { id: string; path: string; name: string; mime: string; size: number }
export function IssueDetail({ issue, attachments, timeline, role, selfId, users, projects, labels, timezone, originChip, issueRefs = [] }: {
  issue: IssueDto; attachments: Attachment[]; timeline: TimelineEntry[]; role: Role; selfId: string
  users: Opt[]; projects: Opt[]; labels: LabelDto[]; timezone: string; originChip?: ReactNode
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
  // The delete gets its OWN transition so its `pending` flag can disable the confirm
  // button without touching the title/description saves above.
  const [confirmDel, setConfirmDel] = useState(false)
  const [pending, startDel] = useTransition()
  // UI gating is cosmetic — deleteIssue asserts the same predicate server-side. Both
  // read the SAME function, so the menu can never offer a delete the server refuses.
  const canDelete = canDeleteIssue(role, issue.creator.id, selfId)
  // Counts for the confirmation copy come from props already in hand — no extra query.
  const commentCount = timeline.filter((e) => e.kind === 'comment').length
  const names = new Map(users.map((u) => [u.id, u.name]))
  const refsMap: Map<number, RefData> = new Map(issueRefs.map((r) => [r.number, r]))
  useEvents((e) => { if (isIssueRefetchEvent(e)) router.refresh() }) // issue events + post-outage reconnect

  function del() {
    startDel(async () => {
      const r = await deleteIssueAction(issue.id)
      // replace(), not push(): this route no longer exists, so leaving it in history
      // would let Back restore a cached RSC payload of the issue we just deleted.
      if (r.ok) router.replace('/issues')
      else { setConfirmDel(false); toast(r.message) }
    })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
      {/* Panel FIRST in source so it stacks ABOVE the content below lg (§6.3);
          on lg the explicit order utilities put the content back in column 1. */}
      <div className="lg:order-2">
        <PropertiesPanel issue={issue} role={role} users={users} projects={projects} labels={labels} />
      </div>
      <div className="min-w-0 space-y-4 lg:order-1">
        <div>
          <div className="flex items-start justify-between gap-2">
            <span className="text-2xs tabular-nums text-subtle">{issue.identifier}</span>
            {/* Rendered ONLY for the creator or an admin — a guest and a non-creator
                member never see the affordance (the project-header.tsx:74 pattern). */}
            {canDelete && (
              <Menu label="Issue actions" button={<MoreHorizontal size={16} aria-hidden />}
                items={[{ label: 'Delete issue', danger: true, onSelect: () => setConfirmDel(true) }]} />
            )}
          </div>
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
      {confirmDel && (
        <Modal title="Delete issue?" onClose={() => setConfirmDel(false)}>
          <p className="text-sm text-muted">
            Deleting <span className="font-semibold text-default">{issue.identifier} {issue.title}</span> permanently
            removes it along with {commentCount} {commentCount === 1 ? 'comment' : 'comments'}, its full activity
            history{attachments.length > 0 ? <> and {attachments.length} {attachments.length === 1 ? 'attachment' : 'attachments'}</> : null}.
            {' '}<span className="font-semibold text-default">This cannot be undone.</span>
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDel(false)} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
            {/* disabled while pending: a double-click would otherwise fire a second
                delete against an already-gone row (an untyped P2025 at the service). */}
            <button type="button" onClick={del} disabled={pending} className="rounded-md bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Delete issue</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
