// Pure health/bucket/ordering logic for /projects and the dashboard (spec §4.7).
// NO 'server-only' — cards import the label/token maps. The token map carries CSS
// custom-property NAMES (the STATUS_TOKEN pattern) — never a hex in a component.
import type { ProjectHealth, ProjectStatus } from '@prisma/client'
import { isProjectUpdateStale } from './stale'

export type HealthBucket = 'off_track' | 'at_risk' | 'no_lead' | 'no_update' | 'on_track'
export type HealthInput = {
  status: ProjectStatus; name: string; hasEffectiveLead: boolean; openOverdue: number
  latestUpdate: { health: ProjectHealth; createdAt: string } | null
}

// Who gets PROMPTED (spec §4.4): a stored guest/banned/system lead degrades to
// "No lead" here — storing them stays legal (§3.2). Applies to prompt delivery and
// to the review screen's No-lead bucket, nowhere else.
export function isEffectiveLead(u: { banned: boolean; isSystem: boolean; role: string } | null | undefined): boolean {
  return !!u && !u.banned && !u.isSystem && u.role !== 'guest'
}

const BUCKET_ORDER: Record<HealthBucket, number> = { off_track: 0, at_risk: 1, no_lead: 2, no_update: 3, on_track: 4 }

// Worst bucket wins (spec §4.7): explicit bad news outranks silence (actionable now);
// an unowned ACTIVE project outranks a merely silent one. A stale OFF_TRACK/AT_RISK
// falls to no_update — old bad news is silence.
export function healthBucket(p: HealthInput, today: string, tz: string): HealthBucket {
  const stale = isProjectUpdateStale(p.latestUpdate?.createdAt ?? null, today, tz)
  if (!stale && p.latestUpdate?.health === 'OFF_TRACK') return 'off_track'
  if (!stale && p.latestUpdate?.health === 'AT_RISK') return 'at_risk'
  if (p.status === 'ACTIVE' && !p.hasEffectiveLead) return 'no_lead'
  if (stale) return 'no_update'
  return 'on_track'
}

// Total order over ACTIVE+PAUSED: bucket, then oldest latestUpdate first with
// never-updated FIRST, then openOverdue desc, then name asc (determinism).
export function compareProjectsWorstFirst(a: HealthInput, b: HealthInput, today: string, tz: string): number {
  const byBucket = BUCKET_ORDER[healthBucket(a, today, tz)] - BUCKET_ORDER[healthBucket(b, today, tz)]
  if (byBucket !== 0) return byBucket
  const at = a.latestUpdate?.createdAt ?? '', bt = b.latestUpdate?.createdAt ?? ''
  if (at !== bt) return at < bt ? -1 : 1 // '' (never) sorts first; ISO strings compare lexically
  if (a.openOverdue !== b.openOverdue) return b.openOverdue - a.openOverdue
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

export const PROJECT_HEALTH_LABEL: Record<ProjectHealth, string> = {
  ON_TRACK: 'On track', AT_RISK: 'At risk', OFF_TRACK: 'Off track',
}
// CSS custom-property names (globals.css §3d, both themes, contrast-gated at the
// 3:1 UI bar; glyph fills ONLY — the visible word renders in text-default).
export const HEALTH_TOKEN: Record<ProjectHealth | 'NONE', string> = {
  ON_TRACK: '--health-on-track', AT_RISK: '--health-at-risk', OFF_TRACK: '--health-off-track', NONE: '--health-none',
}

// Shareable URL params, the parseIssueFilters posture: unknown values degrade to
// no-filter, never reaching a Prisma enum column (spec §4.7).
export type ProjectFilterParams = { health?: 'on_track' | 'at_risk' | 'off_track' | 'no_update'; attention?: true }
const HEALTH_FILTERS = ['on_track', 'at_risk', 'off_track', 'no_update'] as const
export function parseProjectFilters(sp: Record<string, string | string[] | undefined>): ProjectFilterParams {
  const one = (v: string | string[] | undefined): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
  const health = one(sp.health)
  return {
    health: health !== undefined && (HEALTH_FILTERS as readonly string[]).includes(health) ? (health as ProjectFilterParams['health']) : undefined,
    attention: one(sp.attention) === '1' ? true : undefined,
  }
}
