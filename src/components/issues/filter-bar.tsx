'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ISSUE_STATUSES, STATUS_LABEL, PRIORITIES, PRIORITY_LABEL } from '@/features/issues/status'

type Opt = { id: string; name: string }
export function FilterBar({ users, projects, lockAssignee }: { users: Opt[]; projects: Opt[]; lockAssignee?: boolean }) {
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams()
  function set(key: string, value: string) {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value); else next.delete(key)
    router.replace(`${pathname}?${next.toString()}`)
  }
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
      <select aria-label="Priority" value={sp.get('priority') ?? ''} onChange={(e) => set('priority', e.target.value)} className={selectCls}>
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
      </select>
    </div>
  )
}
