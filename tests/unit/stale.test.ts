import { describe, it, expect } from 'vitest'
import {
  STALE_ISSUE_DAYS,
  STALE_PROJECT_DAYS,
  STARTED_STATUSES,
  daysSinceOrgDay,
  isIssueStalled,
  isProjectUpdateStale,
} from '@/features/issues/stale'
import { ISSUE_STATUSES } from '@/features/issues/status'

// Staleness is DAY-granular in the ORG zone (mirrors due.ts), never a rolling
// 14×86_400_000 ms window: the "stalled" chip, the stalled filter, the prompt
// digest's untouched count and the project "No update" bucket must all agree with
// what formatDay renders. These pin the boundaries (13/14/15, 20/21/22), the org
// zone winning over UTC, and the "absent touch ⇒ not stalled" posture.
const SGT = 'Asia/Singapore' // +08:00, the org default
const TODAY = '2026-07-20' // a Monday

// 12:00 SGT on the given ORG day (= 04:00Z), i.e. unambiguously that org day.
const noonSgt = (orgDay: string) => new Date(`${orgDay}T04:00:00Z`)

describe('stale thresholds', () => {
  it('are the spec constants: 14 days for issues, 21 (three missed weekly prompts) for projects', () => {
    expect(STALE_ISSUE_DAYS).toBe(14)
    expect(STALE_PROJECT_DAYS).toBe(21)
    expect(STALE_PROJECT_DAYS).toBe(3 * 7)
  })
})

describe('STARTED_STATUSES', () => {
  it('is exactly the started pair, in board order (the prompt job SELECTs this set)', () => {
    expect(STARTED_STATUSES).toEqual(['IN_PROGRESS', 'IN_REVIEW'])
  })
})

describe('daysSinceOrgDay', () => {
  it('counts whole org-calendar days back from `today`', () => {
    expect(daysSinceOrgDay(noonSgt(TODAY), TODAY, SGT)).toBe(0)
    expect(daysSinceOrgDay(noonSgt('2026-07-19'), TODAY, SGT)).toBe(1)
    expect(daysSinceOrgDay(noonSgt('2026-07-07'), TODAY, SGT)).toBe(13)
    expect(daysSinceOrgDay(noonSgt('2026-07-06'), TODAY, SGT)).toBe(14)
    expect(daysSinceOrgDay(noonSgt('2026-07-05'), TODAY, SGT)).toBe(15)
    expect(daysSinceOrgDay(noonSgt('2026-06-30'), TODAY, SGT)).toBe(20)
    expect(daysSinceOrgDay(noonSgt('2026-06-29'), TODAY, SGT)).toBe(21)
    expect(daysSinceOrgDay(noonSgt('2026-06-28'), TODAY, SGT)).toBe(22)
  })

  it('accepts an ISO string as well as a Date', () => {
    expect(daysSinceOrgDay('2026-07-06T04:00:00.000Z', TODAY, SGT)).toBe(14)
    expect(daysSinceOrgDay(new Date('2026-07-06T04:00:00.000Z'), TODAY, SGT)).toBe(14)
  })

  it('is negative for a future org day (callers only ever compare with >=)', () => {
    expect(daysSinceOrgDay(noonSgt('2026-07-21'), TODAY, SGT)).toBe(-1)
  })

  it('resolves the org day, not the UTC day, across the day boundary', () => {
    // 23:30 SGT on 6 Jul = 15:30Z on 6 Jul — org day and UTC day agree ⇒ 14.
    expect(daysSinceOrgDay('2026-07-06T15:30:00Z', TODAY, SGT)).toBe(14)
    // One hour later the ORG day flips to 7 Jul (00:30 SGT) while the UTC day is
    // still 6 Jul: SGT ⇒ 13 (not yet stale), UTC ⇒ 14. The zone decides.
    expect(daysSinceOrgDay('2026-07-06T16:30:00Z', TODAY, SGT)).toBe(13)
    expect(daysSinceOrgDay('2026-07-06T16:30:00Z', TODAY, 'UTC')).toBe(14)
    // 01:30Z the next day is 09:30 SGT on 7 Jul — same org day as above ⇒ 13.
    expect(daysSinceOrgDay('2026-07-07T01:30:00Z', TODAY, SGT)).toBe(13)
  })

  it('ignores the time of day within an org day', () => {
    expect(daysSinceOrgDay('2026-07-05T16:00:00Z', TODAY, SGT)) // 00:00 SGT on 6 Jul
      .toBe(daysSinceOrgDay('2026-07-06T15:59:59Z', TODAY, SGT)) // 23:59 SGT on 6 Jul
  })
})

describe('isIssueStalled', () => {
  it('is true for started work untouched for >= 14 org days', () => {
    expect(isIssueStalled('IN_PROGRESS', noonSgt('2026-07-06'), TODAY, SGT)).toBe(true)
    expect(isIssueStalled('IN_PROGRESS', noonSgt('2026-07-05'), TODAY, SGT)).toBe(true)
    expect(isIssueStalled('IN_REVIEW', noonSgt('2026-07-06'), TODAY, SGT)).toBe(true)
  })

  it('is false one day short of the threshold (13 days)', () => {
    expect(isIssueStalled('IN_PROGRESS', noonSgt('2026-07-07'), TODAY, SGT)).toBe(false)
    expect(isIssueStalled('IN_REVIEW', noonSgt('2026-07-07'), TODAY, SGT)).toBe(false)
  })

  it('is true for the started pair only — every other status is never stalled, however old the touch', () => {
    const ancient = noonSgt('2026-01-01')
    expect(ISSUE_STATUSES.map((s) => [s, isIssueStalled(s, ancient, TODAY, SGT)])).toEqual([
      ['BACKLOG', false], ['TODO', false], ['IN_PROGRESS', true],
      ['IN_REVIEW', true], ['DONE', false], ['CANCELED', false],
    ])
  })

  it('is false when the last touch is missing (optimistic mutation results)', () => {
    expect(isIssueStalled('IN_PROGRESS', null, TODAY, SGT)).toBe(false)
    expect(isIssueStalled('IN_PROGRESS', undefined, TODAY, SGT)).toBe(false)
    expect(isIssueStalled('IN_REVIEW', undefined, TODAY, SGT)).toBe(false)
  })

  it('brackets the boundary in the ORG zone, not UTC', () => {
    // 00:30 SGT on 7 Jul (= 16:30Z on 6 Jul): 13 org days ⇒ not stalled in SGT,
    // but 14 UTC days ⇒ stalled if the zone were ignored.
    expect(isIssueStalled('IN_PROGRESS', '2026-07-06T16:30:00Z', TODAY, SGT)).toBe(false)
    expect(isIssueStalled('IN_PROGRESS', '2026-07-06T16:30:00Z', TODAY, 'UTC')).toBe(true)
  })
})

describe('isProjectUpdateStale', () => {
  it('treats a never-updated project as stale', () => {
    expect(isProjectUpdateStale(null, TODAY, SGT)).toBe(true)
  })

  it('flips at 21 org days', () => {
    expect(isProjectUpdateStale(noonSgt('2026-06-30'), TODAY, SGT)).toBe(false) // 20
    expect(isProjectUpdateStale(noonSgt('2026-06-29'), TODAY, SGT)).toBe(true) // 21
    expect(isProjectUpdateStale(noonSgt('2026-06-28'), TODAY, SGT)).toBe(true) // 22
  })

  it('accepts the ISO strings the DTOs carry', () => {
    expect(isProjectUpdateStale('2026-07-19T02:00:00.000Z', TODAY, SGT)).toBe(false)
    expect(isProjectUpdateStale('2026-06-28T02:00:00.000Z', TODAY, SGT)).toBe(true)
  })
})
