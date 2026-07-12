'use client'
import { useSyncExternalStore, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/modal'
import { IssueMentionInput } from './issue-mention-input'
import { LabelPicker } from './label-picker'
import { StatusIcon, PriorityIcon } from './status'
import { Menu } from '@/components/ui/menu'
import { ISSUE_STATUSES, STATUS_LABEL, PRIORITIES, PRIORITY_LABEL } from '@/features/issues/status'
import { createIssueAction } from '@/app/(app)/issues/actions'
import { subscribeIssueComposer, getIssueComposer, closeIssueComposer } from '@/lib/issue-composer-store'
import { toast } from '@/lib/toast-store'
import type { IssueStatus, IssuePriority } from '@prisma/client'

type Opt = { id: string; name: string; image?: string | null }
type LabelOpt = { id: string; name: string; color: string }
export function CreateIssueModal({ users, projects, labels }: { users: Opt[]; projects: Opt[]; labels: LabelOpt[] }) {
  const store = useSyncExternalStore(subscribeIssueComposer, getIssueComposer, getIssueComposer)
  if (!store.open) return null
  return <Composer users={users} projects={projects} labels={labels} />
}

function Composer({ users, projects, labels }: { users: Opt[]; projects: Opt[]; labels: LabelOpt[] }) {
  const router = useRouter()
  const { prefill } = getIssueComposer()
  const [title, setTitle] = useState(prefill.title ?? '')
  const [description, setDescription] = useState(prefill.description ?? '')
  const [status, setStatus] = useState<IssueStatus>('BACKLOG')
  const [priority, setPriority] = useState<IssuePriority>('NONE')
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(prefill.projectId ?? null)
  const [dueDate, setDueDate] = useState('')
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [pending, start] = useTransition()

  function submit() {
    const t = title.trim(); if (!t) { toast('Enter a title.'); return }
    start(async () => {
      const r = await createIssueAction({ title: t, description, status, priority, assigneeId, projectId, dueDate: dueDate || null, labelIds, originMessageId: prefill.originMessageId ?? null })
      if (r.ok) { closeIssueComposer(); router.push(`/issues/${r.data.identifier}`) }
      else toast(r.message)
    })
  }
  return (
    <Modal title="New issue" wide onClose={closeIssueComposer}>
      <div className="space-y-3">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Issue title" placeholder="Issue title"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
        <IssueMentionInput value={description} onChange={setDescription} users={users} rows={4} ariaLabel="Issue description" placeholder="Add a description…  @ to mention" />
        <div className="flex flex-wrap gap-2">
          <Menu label="Status" button={<span className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm text-default"><StatusIcon status={status} />{STATUS_LABEL[status]}</span>} items={ISSUE_STATUSES.map((s) => ({ label: STATUS_LABEL[s], onSelect: () => setStatus(s) }))} />
          <Menu label="Priority" button={<span className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm text-default"><PriorityIcon priority={priority} />{PRIORITY_LABEL[priority]}</span>} items={PRIORITIES.map((p) => ({ label: PRIORITY_LABEL[p], onSelect: () => setPriority(p) }))} />
          <Menu label="Assignee" button={<span className="rounded-md border border-border px-2 py-1 text-sm text-default">{users.find((u) => u.id === assigneeId)?.name ?? 'Unassigned'}</span>} items={[{ label: 'Unassigned', onSelect: () => setAssigneeId(null) }, ...users.map((u) => ({ label: u.name, onSelect: () => setAssigneeId(u.id) }))]} />
          <Menu label="Project" button={<span className="rounded-md border border-border px-2 py-1 text-sm text-default">{projects.find((p) => p.id === projectId)?.name ?? 'No project'}</span>} items={[{ label: 'No project', onSelect: () => setProjectId(null) }, ...projects.map((p) => ({ label: p.name, onSelect: () => setProjectId(p.id) }))]} />
          <input type="date" aria-label="Due date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
        </div>
        {/* Labels — same type-to-create picker as the properties panel (§6.5 lists labels among the property pickers). */}
        <LabelPicker labels={labels} selectedIds={labelIds} canEdit onChange={setLabelIds} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={closeIssueComposer} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
          <button type="button" onClick={submit} disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Create issue</button>
        </div>
      </div>
    </Modal>
  )
}
