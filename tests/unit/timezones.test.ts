import { describe, it, expect } from 'vitest'
import { isValidTimezone, TIMEZONES } from '@/lib/timezones'

describe('timezones', () => {
  it('contains Singapore and Berlin (beyond the old 7-zone list)', () => {
    expect(TIMEZONES).toContain('Asia/Singapore')
    expect(TIMEZONES).toContain('Europe/Berlin')
  })
  it('rejects junk', () => {
    expect(isValidTimezone('Asia/Singapore')).toBe(true)
    expect(isValidTimezone('Not/AZone')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })
})
