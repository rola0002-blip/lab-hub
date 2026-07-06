import { describe, it, expect } from 'vitest'
import { formatRange } from './time'

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
