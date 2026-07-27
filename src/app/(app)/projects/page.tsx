import { FolderKanban } from 'lucide-react'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { getOrg } from '@/lib/org'
import { listProjects } from '@/features/issues/project-service'
import { orgToday } from '@/features/issues/due'
import { compareProjectsWorstFirst, healthBucket, parseProjectFilters } from '@/features/issues/project-health'
import { ProjectCard } from '@/components/issues/project-card'
import { ProjectFilterBar } from '@/components/issues/project-filter-bar'
import { NewProjectButton } from '@/components/issues/project-composer'
import { EmptyState } from '@/components/ui/empty-state'

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser()
  const sp = await searchParams
  const f = parseProjectFilters(sp)
  const [projects, users, org] = await Promise.all([
    listProjects(),
    prisma.user.findMany({ where: { banned: false, isSystem: false }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    getOrg(),
  ])
  const timezone = org?.timezone ?? 'Asia/Singapore'
  const today = orgToday(new Date(), timezone)
  // Review list = ACTIVE + PAUSED, worst-first; closed work keeps today's order below.
  let review = projects.filter((p) => p.status === 'ACTIVE' || p.status === 'PAUSED')
    .sort((a, b) => compareProjectsWorstFirst(a, b, today, timezone))
  if (f.health) review = review.filter((p) => healthBucket(p, today, timezone) === f.health)
  if (f.attention) review = review.filter((p) => p.status === 'ACTIVE' && healthBucket(p, today, timezone) !== 'on_track')
  const closed = projects.filter((p) => p.status === 'COMPLETED' || p.status === 'CANCELED')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-default">Projects</h1>
        {user.role !== 'guest' && <NewProjectButton users={users} />}
      </div>
      <ProjectFilterBar />
      {review.length === 0 ? (
        <EmptyState icon={FolderKanban} title={f.health || f.attention ? 'No projects match this filter' : 'No projects yet'}
          hint={f.health || f.attention ? 'Loosen or clear the filter to see more projects.' : 'Create a project to group issues and track progress toward a target date.'} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{review.map((p) => <ProjectCard key={p.id} project={p} timezone={timezone} today={today} />)}</div>
      )}
      {closed.length > 0 && (
        <section className="space-y-3 pt-4">
          <h2 className="text-sm font-semibold text-muted">Completed &amp; cancelled</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{closed.map((p) => <ProjectCard key={p.id} project={p} timezone={timezone} today={today} />)}</div>
        </section>
      )}
    </div>
  )
}
