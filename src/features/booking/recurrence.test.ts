import { describe, it, expect } from 'vitest'
import { expandWeekly, NonexistentWallTimeError } from './recurrence'

describe('expandWeekly', () => {
  it('expands Tuesdays 14:00–18:00 SGT over three weeks (until inclusive)', () => {
    const occ = expandWeekly({
      daysOfWeek: [2], startMinutes: 14 * 60, durationMinutes: 240,
      firstDate: '2026-07-14', untilDate: '2026-07-28', timezone: 'Asia/Singapore',
    })
    expect(occ).toHaveLength(3) // 14, 21, 28 July are Tuesdays
    // 14:00 SGT == 06:00 UTC
    expect(occ[0].startsAt.toISOString()).toBe('2026-07-14T06:00:00.000Z')
    expect(occ[0].endsAt.toISOString()).toBe('2026-07-14T10:00:00.000Z')
    expect(occ[2].startsAt.toISOString()).toBe('2026-07-28T06:00:00.000Z')
  })
  it('handles multiple weekdays and skips days before firstDate', () => {
    const occ = expandWeekly({
      daysOfWeek: [1, 4], startMinutes: 9 * 60, durationMinutes: 60,
      firstDate: '2026-07-15', untilDate: '2026-07-21', timezone: 'Asia/Singapore',
    })
    // Wed 15..Tue 21: Thu 16 and Mon 20 match
    expect(occ.map((o) => o.startsAt.toISOString())).toEqual(['2026-07-16T01:00:00.000Z', '2026-07-20T01:00:00.000Z'])
  })
  it('returns empty for an inverted range', () => {
    expect(expandWeekly({ daysOfWeek: [1], startMinutes: 0, durationMinutes: 60, firstDate: '2026-07-20', untilDate: '2026-07-01', timezone: 'UTC' })).toEqual([])
  })
})

describe('expandWeekly — DST guard', () => {
  it('throws NonexistentWallTimeError naming the occurrence date for a skipped wall time', () => {
    // Sundays 02:30 America/New_York: 2026-03-08 02:30 does not exist (spring forward).
    const rule = { daysOfWeek: [0], startMinutes: 2 * 60 + 30, durationMinutes: 60,
      firstDate: '2026-03-01', untilDate: '2026-03-15', timezone: 'America/New_York' }
    expect(() => expandWeekly(rule)).toThrow(NonexistentWallTimeError)
    let caught: NonexistentWallTimeError | undefined
    try { expandWeekly(rule) } catch (e) { if (e instanceof NonexistentWallTimeError) caught = e }
    expect(caught?.date).toBe('2026-03-08')
  })
  it('expands the same Sundays at 03:30 without throwing (EST before, EDT after)', () => {
    const occ = expandWeekly({ daysOfWeek: [0], startMinutes: 3 * 60 + 30, durationMinutes: 60,
      firstDate: '2026-03-01', untilDate: '2026-03-15', timezone: 'America/New_York' })
    expect(occ.map((o) => o.startsAt.toISOString()))
      .toEqual(['2026-03-01T08:30:00.000Z', '2026-03-08T07:30:00.000Z', '2026-03-15T07:30:00.000Z'])
  })
})
