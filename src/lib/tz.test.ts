import { describe, it, expect } from 'vitest'
import { dayAnchor } from './tz'

describe('dayAnchor', () => {
  // Regression guard: vitest runs in the host system tz (SGT/UTC here). The old
  // string-parse (`new TZDate(`${date}T00:00:00`, tz)`) fixed the instant in the
  // system tz then relabelled, so a negative-offset org (America/New_York) landed
  // on the previous calendar day. The numeric-component constructor must yield the
  // requested y/m/d REGARDLESS of the system tz.
  it('anchors the requested day in a negative-offset org (America/New_York)', () => {
    const a = dayAnchor('2026-07-13', 'America/New_York')
    expect(a.getFullYear()).toBe(2026)
    expect(a.getMonth()).toBe(6) // July, 0-indexed
    expect(a.getDate()).toBe(13)
  })

  it('anchors the requested day in a positive-offset org (Asia/Singapore)', () => {
    const a = dayAnchor('2026-07-13', 'Asia/Singapore')
    expect(a.getFullYear()).toBe(2026)
    expect(a.getMonth()).toBe(6)
    expect(a.getDate()).toBe(13)
  })

  it('falls back to now for malformed or missing params', () => {
    const tz = 'Asia/Singapore'
    // Today's year in the org tz, computed independently of the code under test.
    const nowYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric' }).format(new Date()))
    for (const bad of ['garbage', '13-07-2026', '2026/07/13', '', undefined, null]) {
      const a = dayAnchor(bad, tz)
      // The fallback is "now" tagged with the org tz; assert it lands on today's
      // year in that zone rather than the (nonexistent) parsed date.
      expect(a.getFullYear()).toBe(nowYear)
      expect(a.timeZone).toBe(tz)
    }
  })
})
