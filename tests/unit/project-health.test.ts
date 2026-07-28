import { describe, it, expect } from 'vitest'
import { ProjectHealth } from '@prisma/client'
import {
  isEffectiveLead,
  healthBucket,
  compareProjectsWorstFirst,
  parseProjectFilters,
  PROJECT_HEALTH_LABEL,
  HEALTH_TOKEN,
  type HealthInput,
} from '@/features/issues/project-health'

const SGT = 'Asia/Singapore'
const TODAY = '2026-07-20'

// Update ages relative to TODAY in the org zone (STALE_PROJECT_DAYS = 21).
const FRESH = '2026-07-19T02:00:00.000Z' // 1 day
const EDGE_FRESH = '2026-06-30T02:00:00.000Z' // 20 days — still fresh
const EDGE_STALE = '2026-06-29T02:00:00.000Z' // 21 days — stale
const STALE = '2026-06-28T02:00:00.000Z' // 22 days

const project = (p: Partial<HealthInput> = {}): HealthInput => ({
  status: 'ACTIVE',
  name: 'Project',
  hasEffectiveLead: true,
  openOverdue: 0,
  latestUpdate: null,
  ...p,
})

const update = (health: ProjectHealth, createdAt: string) => ({ health, createdAt })

describe('isEffectiveLead', () => {
  it('accepts an active human member or admin', () => {
    expect(isEffectiveLead({ banned: false, isSystem: false, role: 'member' })).toBe(true)
    expect(isEffectiveLead({ banned: false, isSystem: false, role: 'admin' })).toBe(true)
  })

  it('rejects absent, banned, system and guest leads (they degrade to "No lead")', () => {
    expect(isEffectiveLead(null)).toBe(false)
    expect(isEffectiveLead(undefined)).toBe(false)
    expect(isEffectiveLead({ banned: true, isSystem: false, role: 'member' })).toBe(false)
    expect(isEffectiveLead({ banned: false, isSystem: true, role: 'member' })).toBe(false)
    expect(isEffectiveLead({ banned: false, isSystem: false, role: 'guest' })).toBe(false)
  })
})

describe('healthBucket', () => {
  it('reports on_track for a fresh ON_TRACK update with a lead', () => {
    expect(healthBucket(project({ latestUpdate: update('ON_TRACK', FRESH) }), TODAY, SGT)).toBe('on_track')
  })

  it('reports the stored health while the update is fresh', () => {
    expect(healthBucket(project({ latestUpdate: update('AT_RISK', FRESH) }), TODAY, SGT)).toBe('at_risk')
    expect(healthBucket(project({ latestUpdate: update('OFF_TRACK', FRESH) }), TODAY, SGT)).toBe('off_track')
  })

  it('lets explicit bad news outrank a missing lead (worst bucket wins)', () => {
    const noLead = { hasEffectiveLead: false }
    expect(healthBucket(project({ ...noLead, latestUpdate: update('OFF_TRACK', FRESH) }), TODAY, SGT)).toBe('off_track')
    expect(healthBucket(project({ ...noLead, latestUpdate: update('AT_RISK', FRESH) }), TODAY, SGT)).toBe('at_risk')
    // ...but a healthy unowned project is surfaced as no_lead, not on_track.
    expect(healthBucket(project({ ...noLead, latestUpdate: update('ON_TRACK', FRESH) }), TODAY, SGT)).toBe('no_lead')
  })

  it('lets staleness dominate stored bad news — old bad news is silence', () => {
    expect(healthBucket(project({ latestUpdate: update('OFF_TRACK', STALE) }), TODAY, SGT)).toBe('no_update')
    expect(healthBucket(project({ latestUpdate: update('AT_RISK', STALE) }), TODAY, SGT)).toBe('no_update')
    expect(healthBucket(project({ latestUpdate: update('ON_TRACK', STALE) }), TODAY, SGT)).toBe('no_update')
  })

  it('flips at the 21-day staleness boundary', () => {
    expect(healthBucket(project({ latestUpdate: update('OFF_TRACK', EDGE_FRESH) }), TODAY, SGT)).toBe('off_track')
    expect(healthBucket(project({ latestUpdate: update('OFF_TRACK', EDGE_STALE) }), TODAY, SGT)).toBe('no_update')
  })

  it('ranks "No lead" above "No update"', () => {
    // Never updated AND unowned ⇒ the actionable gap (no lead) is what we show.
    expect(healthBucket(project({ hasEffectiveLead: false, latestUpdate: null }), TODAY, SGT)).toBe('no_lead')
    expect(healthBucket(project({ hasEffectiveLead: false, latestUpdate: update('ON_TRACK', STALE) }), TODAY, SGT)).toBe(
      'no_lead',
    )
    expect(healthBucket(project({ hasEffectiveLead: true, latestUpdate: null }), TODAY, SGT)).toBe('no_update')
  })

  it('only nags about a missing lead on ACTIVE projects', () => {
    const paused = { status: 'PAUSED' as const, hasEffectiveLead: false }
    expect(healthBucket(project({ ...paused, latestUpdate: update('ON_TRACK', FRESH) }), TODAY, SGT)).toBe('on_track')
    expect(healthBucket(project({ ...paused, latestUpdate: null }), TODAY, SGT)).toBe('no_update')
    expect(healthBucket(project({ ...paused, latestUpdate: update('OFF_TRACK', FRESH) }), TODAY, SGT)).toBe('off_track')
  })

  it('resolves staleness in the org zone', () => {
    // 16:30Z on 29 Jun is 00:30 SGT on 30 Jun ⇒ 20 org days (fresh) but 21 UTC days.
    const p = project({ latestUpdate: update('ON_TRACK', '2026-06-29T16:30:00.000Z') })
    expect(healthBucket(p, TODAY, SGT)).toBe('on_track')
    expect(healthBucket(p, TODAY, 'UTC')).toBe('no_update')
  })
})

describe('compareProjectsWorstFirst', () => {
  const sortNames = (ps: HealthInput[]) =>
    [...ps].sort((a, b) => compareProjectsWorstFirst(a, b, TODAY, SGT)).map((p) => p.name)

  it('orders by bucket: off_track, at_risk, no_lead, no_update, on_track', () => {
    const ps = [
      project({ name: 'e-on-track', latestUpdate: update('ON_TRACK', FRESH) }),
      project({ name: 'c-no-lead', hasEffectiveLead: false, latestUpdate: update('ON_TRACK', FRESH) }),
      project({ name: 'a-off-track', latestUpdate: update('OFF_TRACK', FRESH) }),
      project({ name: 'd-no-update', latestUpdate: update('ON_TRACK', STALE) }),
      project({ name: 'b-at-risk', latestUpdate: update('AT_RISK', FRESH) }),
    ]
    expect(sortNames(ps)).toEqual(['a-off-track', 'b-at-risk', 'c-no-lead', 'd-no-update', 'e-on-track'])
  })

  it('within a bucket puts never-updated first, then the oldest update', () => {
    const ps = [
      project({ name: 'middle', latestUpdate: update('ON_TRACK', STALE) }),
      project({ name: 'never', latestUpdate: null }),
      project({ name: 'oldest', latestUpdate: update('ON_TRACK', '2026-01-01T00:00:00.000Z') }),
    ]
    expect(sortNames(ps)).toEqual(['never', 'oldest', 'middle'])
  })

  it('breaks an update-time tie by openOverdue descending', () => {
    const ps = [
      project({ name: 'few', latestUpdate: null, openOverdue: 1 }),
      project({ name: 'many', latestUpdate: null, openOverdue: 9 }),
      project({ name: 'none', latestUpdate: null, openOverdue: 0 }),
    ]
    expect(sortNames(ps)).toEqual(['many', 'few', 'none'])
  })

  it('breaks a full tie by name ascending (determinism)', () => {
    const ps = [
      project({ name: 'Charlie', latestUpdate: update('OFF_TRACK', FRESH) }),
      project({ name: 'Alpha', latestUpdate: update('OFF_TRACK', FRESH) }),
      project({ name: 'Bravo', latestUpdate: update('OFF_TRACK', FRESH) }),
    ]
    expect(sortNames(ps)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(
      compareProjectsWorstFirst(
        project({ name: 'Same', latestUpdate: update('OFF_TRACK', FRESH) }),
        project({ name: 'Same', latestUpdate: update('OFF_TRACK', FRESH) }),
        TODAY,
        SGT,
      ),
    ).toBe(0)
  })

  it('is antisymmetric on the bucket axis', () => {
    const worse = project({ name: 'x', latestUpdate: update('OFF_TRACK', FRESH) })
    const better = project({ name: 'x', latestUpdate: update('ON_TRACK', FRESH) })
    expect(compareProjectsWorstFirst(worse, better, TODAY, SGT)).toBeLessThan(0)
    expect(compareProjectsWorstFirst(better, worse, TODAY, SGT)).toBeGreaterThan(0)
  })
})

describe('PROJECT_HEALTH_LABEL / HEALTH_TOKEN', () => {
  const ALL = Object.values(ProjectHealth) as ProjectHealth[]

  it('labels every stored health value', () => {
    expect(ALL.length).toBe(3)
    expect(Object.keys(PROJECT_HEALTH_LABEL).sort()).toEqual([...ALL].sort())
    expect(PROJECT_HEALTH_LABEL.ON_TRACK).toBe('On track')
    expect(PROJECT_HEALTH_LABEL.AT_RISK).toBe('At risk')
    expect(PROJECT_HEALTH_LABEL.OFF_TRACK).toBe('Off track')
  })

  it('maps every health value plus the derived NONE to a --health-* custom property', () => {
    expect(Object.keys(HEALTH_TOKEN).sort()).toEqual([...ALL, 'NONE'].sort())
    for (const key of Object.keys(HEALTH_TOKEN)) expect(HEALTH_TOKEN[key as keyof typeof HEALTH_TOKEN]).toMatch(/^--health-/)
    expect(HEALTH_TOKEN.NONE).toBe('--health-none')
    // Token NAMES only — a component must never see a hex here.
    for (const v of Object.values(HEALTH_TOKEN)) expect(v).not.toMatch(/#|rgb|oklch/)
  })
})

describe('parseProjectFilters', () => {
  it('accepts the four known health values', () => {
    for (const h of ['on_track', 'at_risk', 'off_track', 'no_update'] as const) {
      expect(parseProjectFilters({ health: h }).health).toBe(h)
    }
  })

  it('degrades an unknown health value to no filter (never reaches a Prisma enum)', () => {
    expect(parseProjectFilters({ health: 'bogus' }).health).toBeUndefined()
    expect(parseProjectFilters({ health: 'ON_TRACK' }).health).toBeUndefined()
    expect(parseProjectFilters({ health: '' }).health).toBeUndefined()
    expect(parseProjectFilters({ health: undefined }).health).toBeUndefined()
    // Repeated params arrive as arrays — also no filter.
    expect(parseProjectFilters({ health: ['on_track', 'at_risk'] }).health).toBeUndefined()
  })

  it('accepts attention=1 only', () => {
    expect(parseProjectFilters({ attention: '1' }).attention).toBe(true)
    expect(parseProjectFilters({ attention: '2' }).attention).toBeUndefined()
    expect(parseProjectFilters({ attention: 'true' }).attention).toBeUndefined()
    expect(parseProjectFilters({ attention: '' }).attention).toBeUndefined()
    expect(parseProjectFilters({ attention: ['1'] }).attention).toBeUndefined()
  })

  it('returns an all-undefined shape for no params', () => {
    expect(parseProjectFilters({})).toEqual({ health: undefined, attention: undefined })
  })

  it('parses both params together', () => {
    expect(parseProjectFilters({ health: 'off_track', attention: '1', junk: 'x' })).toEqual({
      health: 'off_track',
      attention: true,
    })
  })
})
