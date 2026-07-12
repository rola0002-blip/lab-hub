import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ProgressBar } from './progress-bar'
import type { ProjectDto } from '@/features/issues/project-service'

const STATUS_VARIANT = { ACTIVE: 'success', PAUSED: 'warning', COMPLETED: 'neutral', CANCELED: 'danger' } as const
export function ProjectCard({ project }: { project: ProjectDto }) {
  return (
    <Link href={`/projects/${project.id}`} className="block rounded-xl border border-border bg-surface p-4 shadow-xs transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
      <div className="flex items-start justify-between gap-2">
        <h2 className="truncate text-md font-semibold text-default">{project.name}</h2>
        <Badge variant={STATUS_VARIANT[project.status]}>{project.status.toLowerCase()}</Badge>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        {project.lead && <><Avatar size={20} name={project.lead.name} id={project.lead.id} image={project.lead.image} /><span className="truncate">{project.lead.name}</span></>}
        {project.targetDate && <span className="ml-auto">{new Date(project.targetDate).toLocaleDateString()}</span>}
      </div>
      <div className="mt-3"><ProgressBar {...project.progress} /></div>
    </Link>
  )
}
