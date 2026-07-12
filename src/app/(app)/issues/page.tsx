import { ListTodo, SearchX } from 'lucide-react'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { getOrg } from '@/lib/org'
import { listIssues, listLabels } from '@/features/issues/issue-service'
import { listProjects } from '@/features/issues/project-service'
import { parseIssueFilters } from '@/features/issues/status'
import { IssuesSurface } from '@/components/issues/issues-surface'
import { FilterBar } from '@/components/issues/filter-bar'
import { NewIssueButton } from '@/components/issues/new-issue-button'
import { EmptyState } from '@/components/ui/empty-state'

export default async function IssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser()
  const sp = await searchParams
  // Validated URL filters: unknown enum values degrade to "no filter" instead of
  // a Prisma enum error (typo'd/stale shared URLs must not 500).
  const f = parseIssueFilters(sp)
  const [issues, users, labels, projects, org] = await Promise.all([
    listIssues({ status: f.status, assigneeId: f.assignee, projectId: f.project, labelId: f.label, priority: f.priority }),
    prisma.user.findMany({ where: { banned: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, image: true } }),
    listLabels(), listProjects(), getOrg(),
  ])
  const timezone = org?.timezone ?? 'Asia/Singapore'
  // Named empty states: filter-empty when any (valid) filter is active, else no-issues.
  const filtered = Boolean(f.status || f.assignee || f.project || f.label || f.priority)
  const empty = filtered
    ? <EmptyState icon={SearchX} title="No issues match these filters" hint="Loosen or clear a filter to see more issues." />
    : <EmptyState icon={ListTodo} title="No issues yet" hint="Create the first issue to start tracking research and lab work." />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-default">Issues</h1>
        {user.role !== 'guest' && <NewIssueButton />}
      </div>
      <FilterBar users={users} projects={projects.map((p) => ({ id: p.id, name: p.name }))} labels={labels} />
      <IssuesSurface key={JSON.stringify(sp)} initial={issues} role={user.role} users={users} timezone={timezone} empty={empty} />
    </div>
  )
}
