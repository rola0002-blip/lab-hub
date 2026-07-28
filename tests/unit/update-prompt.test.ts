import { describe, it, expect } from 'vitest'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import {
  promptAtFor,
  nthPromptAfter,
  shouldPrompt,
  promptDigestLine,
} from '@/features/issues/update-prompt'

const SGT = 'Asia/Singapore' // +08:00, no DST — the org default
const LONDON = 'Europe/London'
const NY = 'America/New_York'

const MON = 1
const SUN = 0
const HOUR = 9

// Local-clock reading of a UTC instant, the thing the operator actually cares
// about ("the prompt lands at 9am"), independent of the offset that day.
const localClock = (d: Date, tz: string) => format(new TZDate(d, tz), 'yyyy-MM-dd HH:mm')

describe('promptAtFor', () => {
  it('returns the UTC instant of hour:00 org-local on the prompt day', () => {
    // Mon 20 Jul 2026, 13:00 SGT. 09:00 SGT = 01:00Z.
    const at = promptAtFor(new Date('2026-07-20T05:00:00Z'), SGT, MON, HOUR)
    expect(at?.toISOString()).toBe('2026-07-20T01:00:00.000Z')
    expect(localClock(at!, SGT)).toBe('2026-07-20 09:00')
  })

  it('returns null when the org weekday is not the prompt day', () => {
    // Tue 21 Jul 2026 in SGT.
    expect(promptAtFor(new Date('2026-07-21T05:00:00Z'), SGT, MON, HOUR)).toBeNull()
  })

  it('gates on the ORG weekday, not the UTC weekday', () => {
    // 2026-07-20T20:00Z is Monday in UTC but already Tue 04:00 in SGT.
    const now = new Date('2026-07-20T20:00:00Z')
    expect(promptAtFor(now, SGT, MON, HOUR)).toBeNull()
    expect(promptAtFor(now, 'UTC', MON, HOUR)?.toISOString()).toBe('2026-07-20T09:00:00.000Z')
    expect(promptAtFor(now, SGT, 2, HOUR)?.toISOString()).toBe('2026-07-21T01:00:00.000Z')
  })

  it('is DST-correct on a spring-forward day (Europe/London, Sun 29 Mar 2026)', () => {
    // Clocks jump 01:00 GMT → 02:00 BST, so 09:00 local is UTC+1 ⇒ 08:00Z.
    // Naive org-midnight + 9h would give 09:00Z (= 10:00 BST) — wrong.
    const at = promptAtFor(new Date('2026-03-29T12:00:00Z'), LONDON, SUN, HOUR)
    expect(at?.toISOString()).toBe('2026-03-29T08:00:00.000Z')
    expect(at?.toISOString()).not.toBe('2026-03-29T09:00:00.000Z')
    expect(localClock(at!, LONDON)).toBe('2026-03-29 09:00')
  })

  it('is DST-correct on a spring-forward day (America/New_York, Sun 8 Mar 2026)', () => {
    // Clocks jump 02:00 EST → 03:00 EDT, so 09:00 local is UTC-4 ⇒ 13:00Z.
    // Naive org-midnight + 9h would give 14:00Z (= 10:00 EDT) — wrong.
    const at = promptAtFor(new Date('2026-03-08T18:00:00Z'), NY, SUN, HOUR)
    expect(at?.toISOString()).toBe('2026-03-08T13:00:00.000Z')
    expect(at?.toISOString()).not.toBe('2026-03-08T14:00:00.000Z')
    expect(localClock(at!, NY)).toBe('2026-03-08 09:00')
  })

  it('is DST-correct on a fall-back day (Europe/London, Sun 25 Oct 2026)', () => {
    // Clocks fall 02:00 BST → 01:00 GMT, so 09:00 local is UTC+0 ⇒ 09:00Z.
    // Naive org-midnight (23:00Z on the 24th, BST) + 9h would give 08:00Z — wrong.
    const at = promptAtFor(new Date('2026-10-25T12:00:00Z'), LONDON, SUN, HOUR)
    expect(at?.toISOString()).toBe('2026-10-25T09:00:00.000Z')
    expect(at?.toISOString()).not.toBe('2026-10-25T08:00:00.000Z')
    expect(localClock(at!, LONDON)).toBe('2026-10-25 09:00')
  })

  it('is DST-correct on a fall-back day (America/New_York, Sun 1 Nov 2026)', () => {
    // Clocks fall 02:00 EDT → 01:00 EST, so 09:00 local is UTC-5 ⇒ 14:00Z.
    const at = promptAtFor(new Date('2026-11-01T18:00:00Z'), NY, SUN, HOUR)
    expect(at?.toISOString()).toBe('2026-11-01T14:00:00.000Z')
    expect(at?.toISOString()).not.toBe('2026-11-01T13:00:00.000Z')
    expect(localClock(at!, NY)).toBe('2026-11-01 09:00')
  })

  it('honors a non-default hour', () => {
    const at = promptAtFor(new Date('2026-07-20T05:00:00Z'), SGT, MON, 17)
    expect(at?.toISOString()).toBe('2026-07-20T09:00:00.000Z')
    expect(localClock(at!, SGT)).toBe('2026-07-20 17:00')
  })
})

describe('nthPromptAfter', () => {
  // Mondays 09:00 SGT in Jul/Aug 2026 are 01:00Z on 6, 13, 20, 27 Jul and 3, 10 Aug.
  const iso = (d: Date) => d.toISOString()

  it('from BEFORE the hour on a prompt day, n=1 is that same day’s prompt', () => {
    const now = new Date('2026-07-06T00:30:00Z') // Mon 08:30 SGT
    expect(iso(nthPromptAfter(now, 1, SGT, MON, HOUR))).toBe('2026-07-06T01:00:00.000Z')
    expect(iso(nthPromptAfter(now, 4, SGT, MON, HOUR))).toBe('2026-07-27T01:00:00.000Z')
  })

  it('from MINUTES AFTER a prompt, n=1 is next week’s prompt (the snooze anchor)', () => {
    const now = new Date('2026-07-06T01:05:00Z') // Mon 09:05 SGT, just after firing
    expect(iso(nthPromptAfter(now, 1, SGT, MON, HOUR))).toBe('2026-07-13T01:00:00.000Z')
    expect(iso(nthPromptAfter(now, 4, SGT, MON, HOUR))).toBe('2026-08-03T01:00:00.000Z')
  })

  it('from MID-WEEK, n=1 is the coming prompt day', () => {
    const now = new Date('2026-07-08T06:00:00Z') // Wed 14:00 SGT
    expect(iso(nthPromptAfter(now, 1, SGT, MON, HOUR))).toBe('2026-07-13T01:00:00.000Z')
    expect(iso(nthPromptAfter(now, 4, SGT, MON, HOUR))).toBe('2026-08-03T01:00:00.000Z')
  })

  it('is strictly after `now` — standing exactly on a prompt skips it', () => {
    const now = new Date('2026-07-06T01:00:00.000Z')
    expect(iso(nthPromptAfter(now, 1, SGT, MON, HOUR))).toBe('2026-07-13T01:00:00.000Z')
  })

  it('yields a strictly increasing weekly sequence', () => {
    const now = new Date('2026-07-08T06:00:00Z')
    const seq = [1, 2, 3, 4, 5].map((n) => nthPromptAfter(now, n, SGT, MON, HOUR))
    expect(seq.map(iso)).toEqual([
      '2026-07-13T01:00:00.000Z',
      '2026-07-20T01:00:00.000Z',
      '2026-07-27T01:00:00.000Z',
      '2026-08-03T01:00:00.000Z',
      '2026-08-10T01:00:00.000Z',
    ])
    for (const d of seq) expect(localClock(d, SGT)).toMatch(/ 09:00$/)
  })

  it('keeps the local clock at hour:00 across a DST transition', () => {
    // Sun 22 Mar 2026 10:00 GMT — that day's 09:00 prompt has passed, so n=1 is
    // the spring-forward Sunday: still 09:00 local, but now 08:00Z (BST).
    const now = new Date('2026-03-22T10:00:00Z')
    const first = nthPromptAfter(now, 1, LONDON, SUN, HOUR)
    const second = nthPromptAfter(now, 2, LONDON, SUN, HOUR)
    expect(iso(first)).toBe('2026-03-29T08:00:00.000Z')
    expect(iso(second)).toBe('2026-04-05T08:00:00.000Z')
    expect(localClock(first, LONDON)).toBe('2026-03-29 09:00')
    expect(localClock(second, LONDON)).toBe('2026-04-05 09:00')
  })

  it('crosses a month boundary correctly (date overflow normalizes)', () => {
    const now = new Date('2026-07-28T06:00:00Z') // Tue 28 Jul, 14:00 SGT
    expect(iso(nthPromptAfter(now, 1, SGT, MON, HOUR))).toBe('2026-08-03T01:00:00.000Z')
  })
})

describe('shouldPrompt', () => {
  const promptAt = new Date('2026-07-20T01:00:00Z')
  const base = { promptAt, lastUpdatePromptAt: null as Date | null, pausedUntil: null as Date | null }

  it('is false before the prompt instant', () => {
    expect(shouldPrompt({ ...base, now: new Date('2026-07-20T00:59:59Z') })).toBe(false)
  })

  it('is true at and after the prompt instant with no latch and no pause', () => {
    expect(shouldPrompt({ ...base, now: promptAt })).toBe(true)
    expect(shouldPrompt({ ...base, now: new Date('2026-07-20T03:00:00Z') })).toBe(true)
  })

  it('is true when the latch predates this week’s prompt', () => {
    expect(
      shouldPrompt({
        ...base,
        now: new Date('2026-07-20T03:00:00Z'),
        lastUpdatePromptAt: new Date('2026-07-13T01:00:00Z'),
      }),
    ).toBe(true)
  })

  it('is false when the latch is at or after this week’s prompt (already fired)', () => {
    const now = new Date('2026-07-20T03:00:00Z')
    expect(shouldPrompt({ ...base, now, lastUpdatePromptAt: promptAt })).toBe(false)
    expect(shouldPrompt({ ...base, now, lastUpdatePromptAt: new Date('2026-07-20T01:00:01Z') })).toBe(false)
  })

  it('is false while paused into the future', () => {
    expect(
      shouldPrompt({ ...base, now: new Date('2026-07-20T03:00:00Z'), pausedUntil: new Date('2026-07-27T01:00:00Z') }),
    ).toBe(false)
  })

  it('is true once the pause is in the past', () => {
    expect(
      shouldPrompt({ ...base, now: new Date('2026-07-20T03:00:00Z'), pausedUntil: new Date('2026-07-19T01:00:00Z') }),
    ).toBe(true)
  })

  it('resumes when pausedUntil is exactly now (<= now resumes)', () => {
    const now = new Date('2026-07-20T03:00:00Z')
    expect(shouldPrompt({ ...base, now, pausedUntil: new Date(now.getTime()) })).toBe(true)
    expect(shouldPrompt({ ...base, now, pausedUntil: new Date(now.getTime() + 1) })).toBe(false)
  })
})

describe('promptDigestLine', () => {
  const args = {
    projectName: 'BN Growth Runs',
    projectId: 'proj_123',
    since: new Date('2026-07-13T01:00:00Z'), // Mon 13 Jul, 09:00 SGT
    closed: 3,
    overdue: 2,
    stalled: 1,
    tz: SGT,
    appUrl: 'https://labhub.example.org',
  }

  it('renders the DM sentence with counts and an absolute project link', () => {
    expect(promptDigestLine(args)).toBe(
      "Time for this week's update on BN Growth Runs. Since Mon 13 Jul: " +
        '3 issues closed, 2 overdue, 1 started but untouched for 2 weeks. ' +
        'Post it: https://labhub.example.org/projects/proj_123',
    )
  })

  it('singularizes exactly one closed issue', () => {
    expect(promptDigestLine({ ...args, closed: 1 })).toContain('1 issue closed,')
  })

  it('reads sensibly with all-zero counts', () => {
    expect(promptDigestLine({ ...args, closed: 0, overdue: 0, stalled: 0 })).toBe(
      "Time for this week's update on BN Growth Runs. Since Mon 13 Jul: " +
        '0 issues closed, 0 overdue, 0 started but untouched for 2 weeks. ' +
        'Post it: https://labhub.example.org/projects/proj_123',
    )
  })

  it('renders `since` in the ORG zone', () => {
    // 2026-07-13T01:00Z is still Sun 12 Jul in UTC-anchored zones west of Greenwich.
    expect(promptDigestLine({ ...args, tz: NY })).toContain('Since Sun 12 Jul:')
  })

  it('links to /projects/<id> under the given appUrl', () => {
    expect(promptDigestLine({ ...args, appUrl: 'https://lab.example.com', projectId: 'p9' })).toContain(
      'Post it: https://lab.example.com/projects/p9',
    )
  })
})
