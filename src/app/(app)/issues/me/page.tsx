import { Inbox, SearchX } from 'lucide-react'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { getOrg } from '@/lib/org'
import { listIssues } from '@/features/issues/issue-service'
import { listProjects } from '@/features/issues/project-service'
import { parseIssueFilters } from '@/features/issues/status'
import { IssuesSurface } from '@/components/issues/issues-surface'
import { FilterBar } from '@/components/issues/filter-bar'
import { NewIssueButton } from '@/components/issues/new-issue-button'
import { EmptyState } from '@/components/ui/empty-state'

export default async function MyIssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser()
  const sp = await searchParams
  // Validated URL filters (assignee is locked to self, so f.assignee is ignored).
  const f = parseIssueFilters(sp)
  const [issues, users, projects, org] = await Promise.all([
    listIssues({ assigneeId: user.id, status: f.status, projectId: f.project, labelId: f.label, priority: f.priority }),
    prisma.user.findMany({ where: { banned: false, isSystem: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, image: true } }),
    listProjects(), getOrg(),
  ])
  const timezone = org?.timezone ?? 'Asia/Singapore'
  const filtered = Boolean(f.status || f.project || f.label || f.priority)
  const empty = filtered
    ? <EmptyState icon={SearchX} title="No issues match these filters" hint="Loosen or clear a filter to see more issues." />
    : <EmptyState icon={Inbox} title="No issues assigned to you" hint="Issues assigned to you will appear here." />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-default">My issues</h1>
        {user.role !== 'guest' && <NewIssueButton />}
      </div>
      <FilterBar users={users} projects={projects.map((p) => ({ id: p.id, name: p.name }))} lockAssignee />
      <IssuesSurface key={JSON.stringify(sp)} initial={issues} role={user.role} users={users} timezone={timezone} closedGrouped empty={empty} />
    </div>
  )
}
