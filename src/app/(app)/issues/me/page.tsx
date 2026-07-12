import { Inbox, SearchX } from 'lucide-react'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { listIssues, listLabels } from '@/features/issues/issue-service'
import { listProjects } from '@/features/issues/project-service'
import { IssueListView } from '@/components/issues/issue-list-view'
import { FilterBar } from '@/components/issues/filter-bar'
import { EmptyState } from '@/components/ui/empty-state'
import type { IssueStatus, IssuePriority } from '@prisma/client'

export default async function MyIssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser()
  const sp = await searchParams
  const [issues, users, labels, projects] = await Promise.all([
    listIssues({ assigneeId: user.id, status: sp.status as IssueStatus, projectId: sp.project, labelId: sp.label, priority: sp.priority as IssuePriority }),
    prisma.user.findMany({ where: { banned: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, image: true } }),
    listLabels(), listProjects(),
  ])
  const filtered = Boolean(sp.status || sp.project || sp.label || sp.priority)
  const empty = filtered
    ? <EmptyState icon={SearchX} title="No issues match these filters" hint="Loosen or clear a filter to see more issues." />
    : <EmptyState icon={Inbox} title="No issues assigned to you" hint="Issues assigned to you will appear here." />
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-default">My issues</h1>
      <FilterBar users={users} projects={projects.map((p) => ({ id: p.id, name: p.name }))} labels={labels} lockAssignee />
      <IssueListView key={JSON.stringify(sp)} issues={issues} role={user.role} users={users} closedGrouped empty={empty} />
    </div>
  )
}
