import Link from 'next/link'
import { UserX } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ProgressBar } from './progress-bar'
import { HealthChip } from './health-chip'
import { formatDay } from '@/lib/time'
import { isProjectUpdateStale, daysSinceOrgDay } from '@/features/issues/stale'
import type { ProjectDto } from '@/features/issues/project-service'

const STATUS_VARIANT = { ACTIVE: 'success', PAUSED: 'warning', COMPLETED: 'neutral', CANCELED: 'danger' } as const

export function ProjectCard({ project, timezone, today }: { project: ProjectDto; timezone: string; today: string }) {
  const stale = isProjectUpdateStale(project.latestUpdate?.createdAt ?? null, today, timezone)
  const updatedDays = project.latestUpdate ? daysSinceOrgDay(project.latestUpdate.createdAt, today, timezone) : null
  return (
    <Link href={`/projects/${project.id}`} className="block rounded-xl border border-border bg-surface p-4 shadow-xs transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
      <div className="flex items-start justify-between gap-2">
        <h2 className="truncate text-md font-semibold text-default">{project.name}</h2>
        <Badge variant={STATUS_VARIANT[project.status]}>{project.status.toLowerCase()}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <HealthChip health={project.latestUpdate?.health ?? null} stale={stale} />
        {project.status === 'ACTIVE' && !project.hasEffectiveLead && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-2xs text-subtle"><UserX size={11} aria-hidden />No lead</span>
        )}
        {/* "updated N days ago" derives from max(ProjectUpdate.createdAt) — NEVER
            Project.updatedAt, which the prompt job's own latch write bumps (§4.0). */}
        <span className="text-2xs text-subtle">{updatedDays === null ? 'never updated' : updatedDays === 0 ? 'updated today' : `updated ${updatedDays}d ago`}</span>
        {project.openOverdue > 0 && <span className="text-2xs font-medium text-[var(--text-overdue)]">{project.openOverdue} overdue</span>}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        {project.lead && <><Avatar size={20} name={project.lead.name} id={project.lead.id} image={project.lead.image} /><span className="truncate">{project.lead.name}</span></>}
        {/* Org-timezone rule (src/lib/time.ts): fixed pattern + org zone, never the
            ambient runtime TZ/locale — deterministic across server/client renders. */}
        {project.targetDate && <span className="ml-auto">{formatDay(new Date(project.targetDate), timezone)}</span>}
      </div>
      <div className="mt-3"><ProgressBar {...project.progress} /></div>
    </Link>
  )
}
