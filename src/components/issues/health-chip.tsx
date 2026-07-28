import { CircleCheck, TriangleAlert, CircleAlert, CircleDashed, type LucideIcon } from 'lucide-react'
import { HEALTH_TOKEN, PROJECT_HEALTH_LABEL } from '@/features/issues/project-health'
import type { ProjectHealth } from '@prisma/client'

// Health chip for project cards, the project header and the dashboard. Never
// colour-alone: a distinct lucide glyph (token fill, 3:1-gated --health-*) + the
// visible word in text-default. `health: null` OR `stale` renders the DERIVED
// "No update" state (spec §4.1) — silence is displayed, never stored.
const GLYPH: Record<ProjectHealth, LucideIcon> = { ON_TRACK: CircleCheck, AT_RISK: TriangleAlert, OFF_TRACK: CircleAlert }

export function HealthChip({ health, stale, className = '' }: { health: ProjectHealth | null; stale: boolean; className?: string }) {
  const none = health === null || stale
  const Icon = none ? CircleDashed : GLYPH[health!]
  const token = none ? HEALTH_TOKEN.NONE : HEALTH_TOKEN[health!]
  const label = none ? 'No update' : PROJECT_HEALTH_LABEL[health!]
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-default ${className}`}>
      <Icon size={14} aria-hidden style={{ color: `var(${token})` }} />
      {label}
    </span>
  )
}
