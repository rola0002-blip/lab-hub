import { describe, it, expect } from 'vitest'
import { parseLocalDateTime } from '@/lib/local-datetime'

describe('parseLocalDateTime', () => {
  it('parses as org-tz wall time, not browser-local', () => {
    // 14:00 in Singapore == 06:00 UTC
    const d = parseLocalDateTime('2026-09-19T14:00', 'Asia/Singapore')
    expect(d.toISOString()).toBe('2026-09-19T06:00:00.000Z')
  })
  it('handles zones west of UTC', () => {
    const d = parseLocalDateTime('2026-09-19T14:00', 'America/New_York')
    expect(d.toISOString()).toBe('2026-09-19T18:00:00.000Z')
  })
})
