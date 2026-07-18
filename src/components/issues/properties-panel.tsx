'use client'
import { useTransition } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Menu } from '@/components/ui/menu'
import { StatusIcon, PriorityIcon } from './status'
import { ISSUE_STATUSES, STATUS_LABEL, PRIORITIES, PRIORITY_LABEL } from '@/features/issues/status'
import { setStatusAction, setAssigneeAction, setPriorityAction, setProjectAction, setDueDateAction } from '@/app/(app)/issues/actions'
import { toast } from '@/lib/toast-store'
import type { IssueDto } from '@/features/issues/issue-service'
import type { Role } from '@/lib/session'

// Content-sized trigger for the property Menus (the primitive's default 28px
// icon trigger would clip these text labels); carries hover + the shared focus ring.
const TRIGGER = 'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

// Hoisted to module scope (not created during render — react-hooks/static-components):
// it closes over nothing, taking label + children as props.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2 py-1.5"><span className="text-xs text-muted">{label}</span>{children}</div>
}

type Opt = { id: string; name: string; image?: string | null }
export function PropertiesPanel({ issue, role, users, projects }: { issue: IssueDto; role: Role; users: Opt[]; projects: Opt[] }) {
  const [, start] = useTransition()
  const canEdit = role !== 'guest'
  return (
    <aside aria-label="Properties" className="space-y-1 rounded-xl border border-border bg-surface p-3">
      <Row label="Status">{canEdit ? <Menu label="Set status" buttonClassName={TRIGGER} button={<span className="flex items-center gap-1 text-sm text-default"><StatusIcon status={issue.status} />{STATUS_LABEL[issue.status]}</span>} items={ISSUE_STATUSES.map((s) => ({ label: STATUS_LABEL[s], onSelect: () => start(() => setStatusAction(issue.id, s).then((r) => { if (!r.ok) toast(r.message) })) }))} /> : <span className="flex items-center gap-1 text-sm text-default"><StatusIcon status={issue.status} />{STATUS_LABEL[issue.status]}</span>}</Row>
      <Row label="Priority">{canEdit ? <Menu label="Set priority" buttonClassName={TRIGGER} button={<span className="flex items-center gap-1 text-sm text-default"><PriorityIcon priority={issue.priority} />{PRIORITY_LABEL[issue.priority]}</span>} items={PRIORITIES.map((p) => ({ label: PRIORITY_LABEL[p], onSelect: () => start(() => setPriorityAction(issue.id, p).then((r) => { if (!r.ok) toast(r.message) })) }))} /> : <span className="flex items-center gap-1 text-sm text-default"><PriorityIcon priority={issue.priority} />{PRIORITY_LABEL[issue.priority]}</span>}</Row>
      <Row label="Assignee">{canEdit ? <Menu label="Set assignee" buttonClassName={TRIGGER} button={issue.assignee ? <span className="flex items-center gap-1 text-sm text-default"><Avatar size={20} name={issue.assignee.name} id={issue.assignee.id} image={issue.assignee.image} />{issue.assignee.name}</span> : <span className="text-sm text-muted">Unassigned</span>} items={[{ label: 'Unassigned', onSelect: () => start(() => setAssigneeAction(issue.id, null).then((r) => { if (!r.ok) toast(r.message) })) }, ...users.map((u) => ({ label: u.name, onSelect: () => start(() => setAssigneeAction(issue.id, u.id).then((r) => { if (!r.ok) toast(r.message) })) }))]} /> : <span className="text-sm text-default">{issue.assignee?.name ?? 'Unassigned'}</span>}</Row>
      <Row label="Project">{canEdit ? <Menu label="Set project" buttonClassName={TRIGGER} button={<span className="text-sm text-default">{issue.project?.name ?? 'No project'}</span>} items={[{ label: 'No project', onSelect: () => start(() => setProjectAction(issue.id, null).then((r) => { if (!r.ok) toast(r.message) })) }, ...projects.map((p) => ({ label: p.name, onSelect: () => start(() => setProjectAction(issue.id, p.id).then((r) => { if (!r.ok) toast(r.message) })) }))]} /> : <span className="text-sm text-default">{issue.project?.name ?? 'No project'}</span>}</Row>
      <Row label="Due date"><input type="date" aria-label="Due date" disabled={!canEdit} defaultValue={issue.dueDate ? issue.dueDate.slice(0, 10) : ''} onChange={(e) => start(() => setDueDateAction(issue.id, e.target.value || null).then((r) => { if (!r.ok) toast(r.message) }))} className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-60" /></Row>
    </aside>
  )
}
