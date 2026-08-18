import { Inbox, SearchX } from 'lucide-react'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { getOrg } from '@/lib/org'
import { listIssues, listLabels } from '@/features/issues/issue-service'
import { listProjectOptions, listPinnedProjects } from '@/features/issues/project-service'
import { parseIssueFilters } from '@/features/issues/status'
import { orgToday } from '@/features/issues/due'
import { isIssueStalled } from '@/features/issues/stale'
import { IssuesSurface } from '@/components/issues/issues-surface'
import { FilterBar } from '@/components/issues/filter-bar'
import { PinnedProjects } from '@/components/issues/pinned-projects'
import { NewIssueButton } from '@/components/issues/new-issue-button'
import { EmptyState } from '@/components/ui/empty-state'

export default async function MyIssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser()
  const sp = await searchParams
  // Validated URL filters (assignee is locked to self, so f.assignee is ignored).
  const f = parseIssueFilters(sp)
  const [issues, users, projects, labels, org, pinned] = await Promise.all([
    listIssues({ assigneeId: user.id, status: f.status, projectId: f.project, labelId: f.label, priority: f.priority, due: f.due }),
    prisma.user.findMany({ where: { banned: false, isSystem: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, image: true } }),
    listProjectOptions(), listLabels(), getOrg(), listPinnedProjects(user.id),
  ])
  const timezone = org?.timezone ?? 'Asia/Singapore'
  const today = orgToday(new Date(), timezone) // org-day reference threaded to the due chips (stable across hydration)
  // Stalled is derived, not queryable — post-filter the listIssues DTOs, the only
  // place lastTouchedAt is populated (spec §5.2). Composes with every other filter.
  const visible = f.stalled ? issues.filter((i) => isIssueStalled(i.status, i.lastTouchedAt ?? null, today, timezone)) : issues
  const filtered = Boolean(f.status || f.project || f.label || f.priority || f.due || f.stalled)
  const empty = filtered
    ? <EmptyState icon={SearchX} title="No issues match these filters" hint="Loosen or clear a filter to see more issues." />
    : <EmptyState icon={Inbox} title="No issues assigned to you" hint="Issues assigned to you will appear here." />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-default">My issues</h1>
        {user.role !== 'guest' && <NewIssueButton />}
      </div>
      {/* F3: per-user pin chips — between the header and the filter bar, all roles. */}
      <PinnedProjects pinned={pinned} projects={projects} activeId={f.project ?? null} />
      <FilterBar users={users} projects={projects} labels={labels} lockAssignee />
      <IssuesSurface key={JSON.stringify(sp)} initial={visible} role={user.role} users={users} timezone={timezone} today={today} closedGrouped empty={empty} />
    </div>
  )
}
