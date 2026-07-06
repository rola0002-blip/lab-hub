import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'

export function formatDay(d: Date, timezone: string): string {
  return format(new TZDate(d, timezone), 'EEE d MMM')
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
