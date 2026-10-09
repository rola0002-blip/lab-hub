import { describe, it, expect } from 'vitest'
import { dayKey, groupByDay } from '@/features/chat/day-groups'

// vitest.config.ts pins TZ=UTC, so local days == UTC days here.
const m = (id: string, createdAt: string) => ({ id, createdAt })

describe('groupByDay', () => {
  it('empty list → no groups', () => {
    expect(groupByDay([])).toEqual([])
  })
  it('groups consecutive same-day rows and records each group\'s global start index', () => {
    const rows = [
      m('a', '2026-10-07T09:00:00.000Z'), m('b', '2026-10-07T23:59:00.000Z'),
      m('c', '2026-10-08T00:00:00.000Z'),
      m('d', '2026-10-09T08:00:00.000Z'), m('e', '2026-10-09T09:00:00.000Z'),
    ]
    const g = groupByDay(rows)
    expect(g.map((x) => x.items.map((i) => i.id))).toEqual([['a', 'b'], ['c'], ['d', 'e']])
    expect(g.map((x) => x.start)).toEqual([0, 2, 3])
    expect(g.map((x) => x.key)).toEqual([dayKey(rows[0].createdAt), dayKey(rows[2].createdAt), dayKey(rows[3].createdAt)])
  })
  it('key is the day, not the first row — prepending same-day rows keeps the key (no remount)', () => {
    const before = groupByDay([m('b', '2026-10-07T12:00:00.000Z')])
    const after = groupByDay([m('a', '2026-10-07T08:00:00.000Z'), m('b', '2026-10-07T12:00:00.000Z')])
    expect(after[0].key).toBe(before[0].key)
  })
  it('dayKey matches the toDateString predicate MessageItem uses for newDay', () => {
    expect(dayKey('2026-10-07T09:00:00.000Z')).toBe(new Date('2026-10-07T09:00:00.000Z').toDateString())
  })
})
