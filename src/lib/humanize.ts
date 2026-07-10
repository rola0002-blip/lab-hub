// Humanized chat timestamps. These are rendered client-side, so "local" means
// the VIEWER's browser timezone — exactly like Slack shows you your own local
// time. The functions are PURE: callers pass `now` explicitly (never call
// `new Date()` in here) so output is deterministic and unit-testable.
//
// "Today"/"Yesterday" is decided by comparing LOCAL calendar (Y/M/D) components,
// mirroring the numeric-component approach in `src/lib/tz.ts` (`dayAnchor`).
// Slicing the ISO/UTC string instead would misfire for any viewer whose offset
// pushes the instant across local midnight. Locale is pinned to en-US so the
// English literals ("Yesterday", "Today", "at") stay consistent with the
// Intl-formatted month/clock parts regardless of the host's default locale.

const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const monthDayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const longMonthDay = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' })
const longMonthDayYear = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

// Whole-day distance between two instants by their LOCAL calendar date:
// 0 = same local day, 1 = `then` is the local day immediately before `ref`.
// Normalising each to a UTC-midnight ordinal cancels DST/offset drift.
function localDayDiff(then: Date, ref: Date): number {
  const a = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate())
  const b = Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate())
  return Math.round((b - a) / 86_400_000)
}

/**
 * Author-line timestamp on a message's leading row.
 *   today     → "9:14 AM"
 *   yesterday → "Yesterday at 9:14 AM"
 *   this year → "Jul 1"
 *   older     → "Jul 1, 2025"
 */
export function humanTime(iso: string, now: Date): string {
  const d = new Date(iso)
  const diff = localDayDiff(d, now)
  if (diff === 0) return clock.format(d)
  if (diff === 1) return `Yesterday at ${clock.format(d)}`
  return d.getFullYear() === now.getFullYear() ? monthDay.format(d) : monthDayYear.format(d)
}

/**
 * Day-divider label separating message runs.
 *   today     → "Today"
 *   yesterday → "Yesterday"
 *   this year → "June 30"
 *   older     → "June 30, 2025"
 */
export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso)
  const diff = localDayDiff(d, now)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.getFullYear() === now.getFullYear() ? longMonthDay.format(d) : longMonthDayYear.format(d)
}

/** Bare clock, e.g. "9:14 AM" — the hover-only timestamp shown in a grouped row's gutter. */
export function clockTime(iso: string): string {
  return clock.format(new Date(iso))
}
