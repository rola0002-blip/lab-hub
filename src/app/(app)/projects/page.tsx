import { FolderKanban } from 'lucide-react'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { listProjects } from '@/features/issues/project-service'
import { ProjectCard } from '@/components/issues/project-card'
import { NewProjectButton } from '@/components/issues/project-composer'
import { EmptyState } from '@/components/ui/empty-state'

export default async function ProjectsPage() {
  const user = await requireUser()
  const [projects, users] = await Promise.all([
    listProjects(),
    prisma.user.findMany({ where: { banned: false }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-default">Projects</h1>
        {user.role !== 'guest' && <NewProjectButton users={users} />}
      </div>
      {projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" hint="Create a project to group issues and track progress toward a target date." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{projects.map((p) => <ProjectCard key={p.id} project={p} />)}</div>
      )}
    </div>
  )
}
