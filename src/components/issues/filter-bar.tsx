'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { ISSUE_STATUSES, STATUS_LABEL, PRIORITIES, PRIORITY_LABEL } from '@/features/issues/status'
import type { LabelDto } from '@/features/issues/issue-service'

type Opt = { id: string; name: string }
// The filter keys this bar owns. "Clear filters" removes exactly these and preserves
// any other query params (so it never clobbers a future view/sort key), and the reset
// button only appears when at least one of them is active.
const FILTER_KEYS = ['status', 'assignee', 'project', 'priority', 'label', 'due', 'stalled']

export function FilterBar({ users, projects, labels, lockAssignee }: { users: Opt[]; projects: Opt[]; labels: LabelDto[]; lockAssignee?: boolean }) {
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams()
  function set(key: string, value: string) {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value); else next.delete(key)
    router.replace(`${pathname}?${next.toString()}`)
  }
  function clearAll() {
    const next = new URLSearchParams(sp.toString())
    for (const k of FILTER_KEYS) next.delete(k)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }
  const hasFilters = FILTER_KEYS.some((k) => sp.get(k))
  const selectCls = 'rounded-md border border-border bg-surface px-2 py-1 text-sm text-default hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter issues">
      <select aria-label="Status" value={sp.get('status') ?? ''} onChange={(e) => set('status', e.target.value)} className={selectCls}>
        <option value="">All statuses</option>
        {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      {!lockAssignee && (
        <select aria-label="Assignee" value={sp.get('assignee') ?? ''} onChange={(e) => set('assignee', e.target.value)} className={selectCls}>
          <option value="">Anyone</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )}
      <select aria-label="Project" value={sp.get('project') ?? ''} onChange={(e) => set('project', e.target.value)} className={selectCls}>
        <option value="">Any project</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {/* F5 label filter — grouped Workspace-first then per project. Hidden
          entirely when no labels exist, so a fresh install sees today's bar. */}
      {labels.length > 0 && (
        <select aria-label="Label" value={sp.get('label') ?? ''} onChange={(e) => set('label', e.target.value)} className={selectCls}>
          <option value="">Any label</option>
          <optgroup label="Workspace">
            {labels.filter((l) => l.projectId === null).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </optgroup>
          {Object.entries(labels.filter((l) => l.projectId !== null).reduce<Record<string, LabelDto[]>>((acc, l) => {
            const key = l.project?.name ?? 'Project'
            ;(acc[key] ??= []).push(l)
            return acc
          }, {})).map(([group, ls]) => (
            <optgroup key={group} label={group}>{ls.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</optgroup>
          ))}
        </select>
      )}
      <select aria-label="Priority" value={sp.get('priority') ?? ''} onChange={(e) => set('priority', e.target.value)} className={selectCls}>
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
      </select>
      {/* Due-date quick filter — flows through the same URL-param → listIssues path as
          the rest; the service resolves it to a dueDate range in the org zone. */}
      <select aria-label="Due date" value={sp.get('due') ?? ''} onChange={(e) => set('due', e.target.value)} className={selectCls}>
        <option value="">Any due date</option>
        <option value="week">Due this week</option>
        <option value="overdue">Overdue</option>
      </select>
      {/* Stalled quick filter (SP8) — applied as a DTO post-filter on the pages. */}
      <select aria-label="Activity" value={sp.get('stalled') ?? ''} onChange={(e) => set('stalled', e.target.value)} className={selectCls}>
        <option value="">Any activity</option>
        <option value="true">Stalled only</option>
      </select>
      {hasFilters && (
        <button type="button" onClick={clearAll}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm text-muted hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
          <X size={14} aria-hidden />Clear filters
        </button>
      )}
    </div>
  )
}
