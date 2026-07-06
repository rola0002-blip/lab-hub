import { describe, it, expect } from 'vitest'
import { formatRange, formatDay, orgNow } from './time'

describe('formatRange', () => {
  it('renders in the org timezone', () => {
    // 06:00 UTC = 14:00 in Singapore (UTC+8)
    const s = new Date('2026-07-14T06:00:00Z')
    const e = new Date('2026-07-14T10:00:00Z')
    expect(formatRange(s, e, 'Asia/Singapore')).toBe('Tue 14 Jul, 14:00–18:00')
  })
  it('spans days explicitly', () => {
    const s = new Date('2026-07-14T14:00:00Z')
    const e = new Date('2026-07-15T02:00:00Z')
    expect(formatRange(s, e, 'Asia/Singapore')).toBe('Tue 14 Jul, 22:00 – Wed 15 Jul, 10:00')
  })
})

describe('formatDay', () => {
  it('renders the weekday and date in the org timezone', () => {
    // 20:00 UTC on 14 Jul = 04:00 on 15 Jul in Singapore (UTC+8): rolls to Wed
    expect(formatDay(new Date('2026-07-14T20:00:00Z'), 'Asia/Singapore')).toBe('Wed 15 Jul')
    expect(formatDay(new Date('2026-07-14T20:00:00Z'), 'UTC')).toBe('Tue 14 Jul')
  })
})

describe('orgNow', () => {
  it('returns the current instant tagged with the org timezone', () => {
    const before = Date.now()
    const now = orgNow('Asia/Singapore')
    const after = Date.now()
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
    expect(now.getTime()).toBeLessThanOrEqual(after)
    expect(now.timeZone).toBe('Asia/Singapore')
  })
})
