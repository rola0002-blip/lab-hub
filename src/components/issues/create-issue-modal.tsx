'use client'
import { useSyncExternalStore, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/modal'
import { IssueMentionInput } from './issue-mention-input'
import { StatusIcon, PriorityIcon } from './status'
import { Menu } from '@/components/ui/menu'
import { ISSUE_STATUSES, STATUS_LABEL, PRIORITIES, PRIORITY_LABEL } from '@/features/issues/status'
import { splitLabelsForProject, type LabelRow } from '@/features/issues/labels'
import { createIssueAction, createLabelAction } from '@/app/(app)/issues/actions'
import { subscribeIssueComposer, getIssueComposer, closeIssueComposer, resolveInitialAssignee } from '@/lib/issue-composer-store'
import { toast } from '@/lib/toast-store'
import type { IssueStatus, IssuePriority } from '@prisma/client'

// Chip-sized trigger for the property Menus. The Menu primitive's default 28px
// icon trigger (h-7 w-7) clips these text chips, so they overflowed and overlapped
// their neighbours; this carries the chip's border + hover + shared focus ring so
// the inner content no longer duplicates them (mirrors properties-panel's TRIGGER).
const CHIP_TRIGGER = 'inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

type Opt = { id: string; name: string; image?: string | null }
export function CreateIssueModal({ users, projects, labels, currentUserId }: { users: Opt[]; projects: Opt[]; labels: LabelRow[]; currentUserId: string }) {
  const store = useSyncExternalStore(subscribeIssueComposer, getIssueComposer, getIssueComposer)
  if (!store.open) return null
  return <Composer users={users} projects={projects} labels={labels} currentUserId={currentUserId} />
}

function Composer({ users, projects, labels, currentUserId }: { users: Opt[]; projects: Opt[]; labels: LabelRow[]; currentUserId: string }) {
  const router = useRouter()
  const { prefill } = getIssueComposer()
  const [title, setTitle] = useState(prefill.title ?? '')
  const [description, setDescription] = useState(prefill.description ?? '')
  // New issues default to Todo (v0.9.5): quick-captured work is actionable, not
  // triage. This is a COMPOSER default only — Backlog stays selectable, and the
  // service/schema default stays BACKLOG (the neutral fallback for any caller that
  // omits status; the composer always sends one explicitly, so no migration).
  const [status, setStatus] = useState<IssueStatus>('TODO')
  const [priority, setPriority] = useState<IssuePriority>('NONE')
  // Quick-capture (c, ⌘K, create-from-chat) defaults the assignee to the current
  // user; the "New issue" buttons leave it unset. Editable in every case.
  const [assigneeId, setAssigneeId] = useState<string | null>(resolveInitialAssignee(prefill, currentUserId))
  const [projectId, setProjectId] = useState<string | null>(prefill.projectId ?? null)
  const [dueDate, setDueDate] = useState('')
  // Wave-8: labels chosen at creation. The server has taken labelIds since v0.16
  // — this is the missing picker. Selection is by id; display resolves against
  // the prop list PLUS labels minted via quick-create this session (local merge,
  // no refresh dependency while the modal is open).
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [minted, setMinted] = useState<LabelRow[]>([])
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [labelPending, startLabel] = useTransition()
  const [pending, start] = useTransition()

  const allLabels = [...labels, ...minted]
  // Pickable = workspace globals + the CURRENTLY selected project's labels — the
  // properties-panel rule, re-derived live as the Project menu changes.
  const pickable = allLabels.filter((l) => l.projectId === null || l.projectId === projectId)
  // Menu item labels must be unique — a global and this project's label can share
  // a name (the partial uniques allow it); disambiguate by scope suffix.
  const nameCounts = new Map<string, number>()
  for (const l of pickable) nameCounts.set(l.name, (nameCounts.get(l.name) ?? 0) + 1)
  const projectName = projects.find((p) => p.id === projectId)?.name
  const displayName = (l: LabelRow): string =>
    (nameCounts.get(l.name) ?? 0) > 1 ? `${l.name} (${l.projectId === null ? 'Workspace' : projectName})` : l.name
  const selected = pickable.filter((l) => labelIds.includes(l.id))
  const labelItems = [
    ...pickable.map((l) => ({
      label: labelIds.includes(l.id) ? `✓ ${displayName(l)}` : displayName(l),
      onSelect: () => setLabelIds((ids) => (ids.includes(l.id) ? ids.filter((x) => x !== l.id) : [...ids, l.id])),
    })),
    { label: 'New label…', onSelect: () => { setDraft(''); setCreating(true) } },
    ...(labelIds.length > 0 ? [{ label: 'Clear labels', onSelect: () => setLabelIds([]) }] : []),
  ]

  // Switching projects must never leave chips the save would silently drop:
  // filter the selection to labels valid on the destination (the v0.16
  // "belongs" definition — splitLabelsForProject — reused, not reinvented).
  function pickProject(id: string | null) {
    setProjectId(id)
    setLabelIds((ids) => {
      const kept = allLabels.filter((l) => ids.includes(l.id))
      return splitLabelsForProject(kept, id).keep.map((l) => l.id)
    })
  }

  // Quick-create mints in the composer's CURRENT scope (selected project, or
  // workspace-global when none) and auto-selects it. Same posture as the
  // properties-panel's quick-create, minus the apply round-trip — the issue
  // doesn't exist yet.
  function submitNewLabel() {
    const name = draft.trim()
    if (!name) return
    startLabel(async () => {
      const r = await createLabelAction(name, projectId)
      if (!r.ok) { toast(r.message); return }
      setMinted((m) => [...m, r.data])
      setLabelIds((ids) => [...ids, r.data.id])
      setCreating(false); setDraft('')
    })
  }

  function submit() {
    const t = title.trim(); if (!t) { toast('Enter a title.'); return }
    start(async () => {
      const r = await createIssueAction({ title: t, description, status, priority, assigneeId, projectId, dueDate: dueDate || null, labelIds, originMessageId: prefill.originMessageId ?? null })
      if (r.ok) { closeIssueComposer(); router.push(`/issues/${r.data.identifier}`) }
      else toast(r.message)
    })
  }
  return (
    <>
      <Modal title="New issue" wide onClose={creating ? () => setCreating(false) : closeIssueComposer}>
      <div className="space-y-3">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Issue title" placeholder="Issue title"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
        <IssueMentionInput value={description} onChange={setDescription} users={users} rows={4} ariaLabel="Issue description" placeholder="Add a description…  @ to mention" />
        <div className="flex flex-wrap gap-2">
          <Menu label="Status" align="left" buttonClassName={CHIP_TRIGGER} button={<><StatusIcon status={status} />{STATUS_LABEL[status]}</>} items={ISSUE_STATUSES.map((s) => ({ label: STATUS_LABEL[s], onSelect: () => setStatus(s) }))} />
          <Menu label="Priority" align="left" buttonClassName={CHIP_TRIGGER} button={<><PriorityIcon priority={priority} />{PRIORITY_LABEL[priority]}</>} items={PRIORITIES.map((p) => ({ label: PRIORITY_LABEL[p], onSelect: () => setPriority(p) }))} />
          <Menu label="Assignee" align="left" buttonClassName={CHIP_TRIGGER} button={users.find((u) => u.id === assigneeId)?.name ?? 'Unassigned'} items={[{ label: 'Unassigned', onSelect: () => setAssigneeId(null) }, ...users.map((u) => ({ label: u.name, onSelect: () => setAssigneeId(u.id) }))]} />
          <Menu label="Project" align="left" buttonClassName={CHIP_TRIGGER} button={projectName ?? 'No project'} items={[{ label: 'No project', onSelect: () => pickProject(null) }, ...projects.map((p) => ({ label: p.name, onSelect: () => pickProject(p.id) }))]} />
          <Menu label="Labels" align="left" buttonClassName={CHIP_TRIGGER} button={<span className="max-w-[16rem] truncate">{selected.length ? selected.map((l) => l.name).join(', ') : 'Labels'}</span>} items={labelItems} />
          <input type="date" aria-label="Due date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={closeIssueComposer} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
          <button type="button" onClick={submit} disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Create issue</button>
        </div>
        </div>
      </Modal>
      {/* Quick-create label dialog — a SIBLING overlay, never nested inside the
          composer Modal: both register document-level Escape listeners, and
          stopPropagation cannot isolate same-node listeners, so a nested copy
          would close BOTH dialogs on Escape. While open it also takes over the
          composer's backdrop close (a stray click mints nothing). */}
      {creating && (
        <Modal title="New label" onClose={() => setCreating(false)}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={40} autoFocus aria-label="Label name" placeholder="Label name"
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim() && !labelPending) submitNewLabel() }}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
          <p className="mt-1 text-xs text-muted">{projectId ? `Creates in the ${projectName} scope.` : 'Creates in the workspace scope.'}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
            <button type="button" onClick={submitNewLabel} disabled={!draft.trim() || labelPending} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Create label</button>
          </div>
        </Modal>
      )}
    </>
  )
}
