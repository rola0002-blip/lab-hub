// Pure prompt-window math for the weekly project-update job (spec §4.2–§4.3) and the
// snooze controls (§4.6). All instants are built by TZDate COMPONENT construction —
// never org-midnight + hour×3.6e6 ms, which is wrong on DST-transition days in the
// four DST zones the settings form offers. NO 'server-only' (the header menu's
// labels and unit tests import it); the DB-reading job lives in src/lib/jobs.ts.
import { TZDate } from '@date-fns/tz'
import { formatDay } from '@/lib/time'
import { orgWeekday } from './due'

// The UTC instant of `hour`:00 (org tz) on `now`'s org day — or null when `now`'s
// org weekday is not the configured prompt day.
export function promptAtFor(now: Date, tz: string, day: number, hour: number): Date | null {
  if (orgWeekday(now, tz) !== day) return null
  const z = new TZDate(now, tz)
  return new Date(+new TZDate(z.getFullYear(), z.getMonth(), z.getDate(), hour, 0, tz))
}

// The instant of the nth prompt strictly AFTER `now`. Anchoring snoozes here — not
// to a rolling now+7d — is what makes "Skip the next prompt" pressed minutes after
// this week's prompt suppress exactly next week's and nothing else (spec §4.6).
export function nthPromptAfter(now: Date, n: number, tz: string, day: number, hour: number): Date {
  const z = new TZDate(now, tz)
  let hits = 0
  for (let i = 0; i < 7 * (n + 2); i++) {
    const cand = new TZDate(z.getFullYear(), z.getMonth(), z.getDate() + i, hour, 0, tz)
    if (cand.getDay() !== day) continue
    const instant = new Date(+cand)
    if (instant > now) { hits++; if (hits === n) return instant }
  }
  throw new Error('nthPromptAfter: unreachable') // loop bound covers n weeks + slack
}

// The per-project selection predicate, pure: fired this week already? snoozed?
export function shouldPrompt(a: { now: Date; promptAt: Date; lastUpdatePromptAt: Date | null; pausedUntil: Date | null }): boolean {
  if (a.now < a.promptAt) return false
  if (a.lastUpdatePromptAt !== null && a.lastUpdatePromptAt >= a.promptAt) return false
  if (a.pausedUntil !== null && a.pausedUntil > a.now) return false
  return true
}

// The DM sentence (spec §4.3). Counts come from the caller (the job); the link is
// APP_URL-absolute so it works from any mail-less DM surface.
export function promptDigestLine(a: {
  projectName: string; projectId: string; since: Date; closed: number; overdue: number; stalled: number; tz: string; appUrl: string
}): string {
  const s = (n: number) => (n === 1 ? '' : 's')
  return `Time for this week's update on ${a.projectName}. Since ${formatDay(a.since, a.tz)}: ` +
    `${a.closed} issue${s(a.closed)} closed, ${a.overdue} overdue, ${a.stalled} started but untouched for 2 weeks. ` +
    `Post it: ${a.appUrl}/projects/${a.projectId}`
}
