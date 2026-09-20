import { describe, it, expect } from 'vitest'
import { wallMinutes, sameOrgDay, wallTimeExists } from '@/lib/wall-time'

describe('wallMinutes', () => {
  it('resolves minutes-of-day and wall date in Asia/Singapore (UTC+8)', () => {
    expect(wallMinutes(new Date('2026-09-21T02:00:00Z'), 'Asia/Singapore'))
      .toEqual({ min: 10 * 60, day: '2026-09-21' })
  })
  it('resolves the same instant in America/New_York on the previous wall day', () => {
    expect(wallMinutes(new Date('2026-09-21T02:00:00Z'), 'America/New_York'))
      .toEqual({ min: 22 * 60, day: '2026-09-20' })
  })
  it('treats 16:00 UTC as minute 0 of the next SG wall day', () => {
    expect(wallMinutes(new Date('2026-09-21T16:00:00Z'), 'Asia/Singapore'))
      .toEqual({ min: 0, day: '2026-09-22' })
  })
})

describe('sameOrgDay', () => {
  it('is false across midnight in the org timezone (23:00 vs next-day 01:00 SGT)', () => {
    expect(sameOrgDay(new Date('2026-09-21T15:00:00Z'), new Date('2026-09-21T17:00:00Z'), 'Asia/Singapore')).toBe(false)
  })
  it('is true for instants on one wall day even when they straddle UTC midnight', () => {
    expect(sameOrgDay(new Date('2026-09-21T16:00:00Z'), new Date('2026-09-21T20:00:00Z'), 'Asia/Singapore')).toBe(true)
  })
})

describe('wallTimeExists', () => {
  it('rejects a wall time skipped by the spring-forward gap (2026-03-08 02:30 New York)', () => {
    expect(wallTimeExists(2026, 3, 8, 2, 30, 'America/New_York')).toBe(false)
  })
  it('accepts 03:30 on the same transition day', () => {
    expect(wallTimeExists(2026, 3, 8, 3, 30, 'America/New_York')).toBe(true)
  })
  it('accepts 01:30 before the skip, and any time in a DST-free zone', () => {
    expect(wallTimeExists(2026, 3, 8, 1, 30, 'America/New_York')).toBe(true)
    expect(wallTimeExists(2026, 3, 8, 2, 30, 'Asia/Singapore')).toBe(true)
  })
})
