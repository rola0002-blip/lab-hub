import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

export function formatDay(d: Date, timezone: string): string {
  return format(new TZDate(d, timezone), 'EEE d MMM')
}

// Absolute date + time in the org timezone, e.g. "14 Jul 2026, 9:14 AM". Used for
// issue-timeline comment/activity timestamps. Deterministic (no `now` reference,
// fixed en pattern via TZDate) so the server-rendered string and the client
// hydration string are byte-identical — no React hydration mismatch — and always
// reads in the ORG zone, never the ambient runtime/browser TZ.
export function formatDateTime(d: Date, timezone: string): string {
  return format(new TZDate(d, timezone), 'd MMM yyyy, h:mm a')
}

export function formatRange(startsAt: Date, endsAt: Date, timezone: string): string {
  const s = new TZDate(startsAt, timezone)
  const e = new TZDate(endsAt, timezone)
  const sameDay = format(s, 'yyyy-MM-dd') === format(e, 'yyyy-MM-dd')
  return sameDay
    ? `${format(s, 'EEE d MMM')}, ${format(s, 'HH:mm')}–${format(e, 'HH:mm')}`
    : `${format(s, 'EEE d MMM')}, ${format(s, 'HH:mm')} – ${format(e, 'EEE d MMM')}, ${format(e, 'HH:mm')}`
}

export function orgNow(timezone: string): TZDate {
  return new TZDate(new Date(), timezone)
}
