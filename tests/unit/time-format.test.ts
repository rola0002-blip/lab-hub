import { describe, it, expect } from 'vitest'
import { formatDay } from '@/lib/time'

// The SP4 due-date cell renders formatDay(dueDate, org.timezone). These pin the
// org-timezone rule: the SAME UTC instant must render as different calendar days
// depending on the ORG zone (never the ambient host TZ — vitest pins TZ=UTC, and
// TZDate makes the output host-independent anyway), with the fixed en 'EEE d MMM'
// pattern so server and client HTML are byte-identical (no hydration mismatch).
describe('formatDay (org timezone, fixed locale)', () => {
  const instant = new Date('2026-01-01T20:00:00Z') // 04:00 Jan 2 in Asia/Singapore (UTC+8)
  it('renders the org-zone calendar day, not the UTC day', () => {
    expect(formatDay(instant, 'Asia/Singapore')).toBe('Fri 2 Jan')
    expect(formatDay(instant, 'UTC')).toBe('Thu 1 Jan')
  })
  it('is deterministic for a plain midnight-UTC due date', () => {
    expect(formatDay(new Date('2026-07-15T00:00:00Z'), 'Asia/Singapore')).toBe('Wed 15 Jul')
  })
})
