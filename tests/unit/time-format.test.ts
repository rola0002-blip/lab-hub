import { describe, it, expect } from 'vitest'
import { formatDay, formatDateTime } from '@/lib/time'

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

// The issue timeline (F4) renders comment/activity times via formatDateTime(org tz).
// It must be an ABSOLUTE org-zone datetime — no `now` reference — so the server
// render and client hydration produce byte-identical strings (no React hydration
// mismatch) and the time reads in the org zone, never the ambient runtime/browser TZ.
describe('formatDateTime (org timezone, deterministic)', () => {
  // 01:14 UTC = the day before in New York (UTC-4/-5), the same-day 09:14 in Singapore.
  const instant = new Date('2026-07-14T01:14:00Z')
  it('renders the org-zone datetime, crossing the day boundary west of UTC', () => {
    expect(formatDateTime(instant, 'Asia/Singapore')).toBe('14 Jul 2026, 9:14 AM')
    expect(formatDateTime(instant, 'America/New_York')).toBe('13 Jul 2026, 9:14 PM')
    expect(formatDateTime(instant, 'UTC')).toBe('14 Jul 2026, 1:14 AM')
  })
  it('is stable regardless of call time (no relative "now")', () => {
    // Calling twice yields the same literal — the property that guarantees SSR==CSR.
    expect(formatDateTime(instant, 'America/New_York')).toBe(formatDateTime(instant, 'America/New_York'))
  })
})
