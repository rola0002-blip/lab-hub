import { describe, it, expect } from 'vitest'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import { orgToday, dueBucket, startOfOrgDay, endOfOrgWeek, dueRange } from './due'

const SGT = 'Asia/Singapore' // +08:00, the org default

describe('orgToday', () => {
  it('reports the calendar day in the org zone, not UTC', () => {
    // 2026-07-19T20:00Z is already 2026-07-20 04:00 in SGT.
    expect(orgToday(new Date('2026-07-19T20:00:00Z'), SGT)).toBe('2026-07-20')
    expect(orgToday(new Date('2026-07-19T20:00:00Z'), 'UTC')).toBe('2026-07-19')
  })
})

describe('dueBucket', () => {
  const today = '2026-07-20'
  it('flags a past due DAY as overdue', () => {
    expect(dueBucket('2026-07-19T00:00:00Z', 'TODO', today, SGT)).toBe('overdue')
    expect(dueBucket(new Date('2026-06-01T00:00:00Z'), 'IN_PROGRESS', today, SGT)).toBe('overdue')
  })
  it('flags the current DAY as today (not overdue), even later in the day', () => {
    // Stored UTC-midnight of the 20th is 08:00 on the 20th in SGT — same day.
    expect(dueBucket('2026-07-20T00:00:00Z', 'TODO', today, SGT)).toBe('today')
  })
  it('flags a future DAY as upcoming', () => {
    expect(dueBucket('2026-07-25T00:00:00Z', 'BACKLOG', today, SGT)).toBe('upcoming')
  })
  it('never flags completed work, regardless of date', () => {
    expect(dueBucket('2026-01-01T00:00:00Z', 'DONE', today, SGT)).toBeNull()
    expect(dueBucket('2026-01-01T00:00:00Z', 'CANCELED', today, SGT)).toBeNull()
  })
  it('has no bucket without a due date', () => {
    expect(dueBucket(null, 'TODO', today, SGT)).toBeNull()
  })
})

describe('startOfOrgDay', () => {
  it('is the UTC instant of 00:00 org-local on now’s day', () => {
    // 2026-07-20 10:00 SGT → start of that day is 2026-07-20 00:00 SGT = 2026-07-19T16:00Z.
    const sod = startOfOrgDay(new Date('2026-07-20T02:00:00Z'), SGT)
    expect(sod.toISOString()).toBe('2026-07-19T16:00:00.000Z')
    expect(format(new TZDate(sod, SGT), 'yyyy-MM-dd HH:mm')).toBe('2026-07-20 00:00')
  })
})

describe('endOfOrgWeek', () => {
  it('is Sunday 23:59 org-local, at or after now (week starts Monday)', () => {
    const now = new Date('2026-07-22T02:00:00Z') // a Wednesday, SGT
    const eow = endOfOrgWeek(now, SGT)
    expect(eow.getTime()).toBeGreaterThan(now.getTime())
    expect(format(new TZDate(eow, SGT), 'EEEE HH:mm')).toBe('Sunday 23:59')
  })
})

describe('dueRange (quick-filter Prisma predicate)', () => {
  const now = new Date('2026-07-22T02:00:00Z')
  it('overdue → strictly before the start of today', () => {
    const r = dueRange('overdue', now, SGT) as { lt: Date }
    expect(r.lt.toISOString()).toBe(startOfOrgDay(now, SGT).toISOString())
    expect('gte' in r).toBe(false)
  })
  it('week → start of today through end of this week', () => {
    const r = dueRange('week', now, SGT) as { gte: Date; lte: Date }
    expect(r.gte.toISOString()).toBe(startOfOrgDay(now, SGT).toISOString())
    expect(r.lte.toISOString()).toBe(endOfOrgWeek(now, SGT).toISOString())
    expect(r.gte.getTime()).toBeLessThan(r.lte.getTime())
  })
})
