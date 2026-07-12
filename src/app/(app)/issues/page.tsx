import { ListTodo, SearchX } from 'lucide-react'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { listIssues, listLabels } from '@/features/issues/issue-service'
import { listProjects } from '@/features/issues/project-service'
import { IssueListView } from '@/components/issues/issue-list-view'
import { FilterBar } from '@/components/issues/filter-bar'
import { EmptyState } from '@/components/ui/empty-state'
import type { IssueStatus, IssuePriority } from '@prisma/client'

export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser()
  const sp = await searchParams
  const [issues, users, labels, projects] = await Promise.all([
    listIssues({ status: sp.status as IssueStatus, assigneeId: sp.assignee, projectId: sp.project, labelId: sp.label, priority: sp.priority as IssuePriority }),
    prisma.user.findMany({ where: { banned: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, image: true } }),
    listLabels(), listProjects(),
  ])
  // Named empty states: filter-empty when any filter is active, else no-issues.
  const filtered = Boolean(sp.status || sp.assignee || sp.project || sp.label || sp.priority)
  const empty = filtered
    ? <EmptyState icon={SearchX} title="No issues match these filters" hint="Loosen or clear a filter to see more issues." />
    : <EmptyState icon={ListTodo} title="No issues yet" hint="Create the first issue to start tracking research and lab work." />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-default">Issues</h1>
      </div>
      <FilterBar users={users} projects={projects.map((p) => ({ id: p.id, name: p.name }))} labels={labels} />
      <IssueListView key={JSON.stringify(sp)} issues={issues} role={user.role} users={users} empty={empty} />
    </div>
  )
}
