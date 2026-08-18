import { describe, it, expect } from 'vitest'
import { sortMilestones, milestoneBucket, toMilestoneDto } from './milestone-state'

const ms = (over: Partial<Parameters<typeof milestoneBucket>[0]> = {}) => ({
  id: 'm1', name: 'M', date: null, completedAt: null, ...over,
})

describe('milestone-state', () => {
  it('sorts dated asc, undated last, then name', () => {
    const got = sortMilestones([ms({ id: 'b', name: 'B', date: '2026-09-02' }), ms({ id: 'u', name: 'Z', date: null }), ms({ id: 'a', name: 'A', date: '2026-09-01' })])
    expect(got.map((m) => m.id)).toEqual(['a', 'b', 'u'])
  })
  it('buckets complete > overdue > upcoming against the org day', () => {
    expect(milestoneBucket(ms({ completedAt: new Date() }), '2026-01-01')).toBe('complete')
    expect(milestoneBucket(ms({ date: '2025-12-31' }), '2026-01-01')).toBe('overdue')
    expect(milestoneBucket(ms({ date: '2026-01-01' }), '2026-01-01')).toBe('upcoming') // due today is not overdue
    expect(milestoneBucket(ms({}), '2026-01-01')).toBe('upcoming')
  })
  it('DTOs completedAt as ISO string or null', () => {
    expect(toMilestoneDto(ms({ completedAt: new Date(0) })).completedAt).toBeTypeOf('string')
    expect(toMilestoneDto(ms({})).completedAt).toBeNull()
  })
})
