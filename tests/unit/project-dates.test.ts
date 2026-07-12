import { describe, it, expect } from 'vitest'
import { formatDay } from '@/lib/time'

// The project header renders both dates as `Start {formatDay(...)}` and
// `Target {formatDay(...)}` from the DTO's ISO strings, through the org-timezone
// helper (never toLocaleDateString). These pin that render contract: the same
// "EEE d MMM" treatment for start as for target, resolved in the ORG zone so the
// server render and client hydration are byte-identical.
describe('project header date rendering', () => {
  const tz = 'Asia/Singapore'
  // Mirrors project-service.toDto: startDate/targetDate are stored as ISO strings.
  const startIso = new Date('2026-09-01T00:00:00Z').toISOString()
  const targetIso = new Date('2026-09-30T00:00:00Z').toISOString()

  it('renders start and target with the identical "Start/Target EEE d MMM" treatment', () => {
    expect(`Start ${formatDay(new Date(startIso), tz)}`).toBe('Start Tue 1 Sep')
    expect(`Target ${formatDay(new Date(targetIso), tz)}`).toBe('Target Wed 30 Sep')
  })

  it('resolves the calendar day in the org zone, not the UTC or host day', () => {
    // 20:00Z on 30 Sep is already 1 Oct in Singapore (UTC+8): the org zone wins.
    const lateIso = new Date('2026-09-30T20:00:00Z').toISOString()
    expect(formatDay(new Date(lateIso), tz)).toBe('Thu 1 Oct')
    expect(formatDay(new Date(lateIso), 'UTC')).toBe('Wed 30 Sep')
  })
})
