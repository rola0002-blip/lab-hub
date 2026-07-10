import { describe, it, expect } from 'vitest'
import { humanTime, dayLabel, clockTime } from '@/lib/humanize'

const now = new Date('2026-07-11T14:00:00Z')
describe('humanize', () => {
  it('humanTime: clock for today, weekday-ish otherwise', () => {
    expect(humanTime('2026-07-11T09:14:00Z', now)).toMatch(/\d{1,2}:\d{2}/)      // today → clock
    expect(humanTime('2026-07-10T09:14:00Z', now)).toMatch(/Yesterday/)          // yesterday
    expect(humanTime('2026-07-01T09:14:00Z', now)).toMatch(/Jul/)                // older → date
  })
  it('dayLabel: Today / Yesterday / date', () => {
    expect(dayLabel('2026-07-11T02:00:00Z', now)).toBe('Today')
    expect(dayLabel('2026-07-10T23:00:00Z', now)).toBe('Yesterday')
    expect(dayLabel('2026-06-30T10:00:00Z', now)).toMatch(/June 30/)
  })
  it('clockTime: bare AM/PM clock (grouped-row gutter)', () => {
    // Pinned to UTC by vitest.config.ts, so 09:14Z formats as the 12-hour clock.
    expect(clockTime('2026-07-11T09:14:00Z')).toBe('9:14 AM')
  })
})
