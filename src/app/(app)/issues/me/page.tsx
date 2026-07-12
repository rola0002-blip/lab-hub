import { Inbox, SearchX } from 'lucide-react'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { getOrg } from '@/lib/org'
import { listIssues, listLabels } from '@/features/issues/issue-service'
import { listProjects } from '@/features/issues/project-service'
import { parseIssueFilters } from '@/features/issues/status'
import { IssueListView } from '@/components/issues/issue-list-view'
import { FilterBar } from '@/components/issues/filter-bar'
import { EmptyState } from '@/components/ui/empty-state'

export default async function MyIssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser()
  const sp = await searchParams
  // Validated URL filters (assignee is locked to self, so f.assignee is ignored).
  const f = parseIssueFilters(sp)
  const [issues, users, labels, projects, org] = await Promise.all([
    listIssues({ assigneeId: user.id, status: f.status, projectId: f.project, labelId: f.label, priority: f.priority }),
    prisma.user.findMany({ where: { banned: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, image: true } }),
    listLabels(), listProjects(), getOrg(),
  ])
  const timezone = org?.timezone ?? 'Asia/Singapore'
  const filtered = Boolean(f.status || f.project || f.label || f.priority)
  const empty = filtered
    ? <EmptyState icon={SearchX} title="No issues match these filters" hint="Loosen or clear a filter to see more issues." />
    : <EmptyState icon={Inbox} title="No issues assigned to you" hint="Issues assigned to you will appear here." />
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-default">My issues</h1>
      <FilterBar users={users} projects={projects.map((p) => ({ id: p.id, name: p.name }))} labels={labels} lockAssignee />
      <IssueListView key={JSON.stringify(sp)} issues={issues} role={user.role} users={users} timezone={timezone} closedGrouped empty={empty} />
    </div>
  )
}
