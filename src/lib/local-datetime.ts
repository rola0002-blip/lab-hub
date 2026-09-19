import { TZDate } from '@date-fns/tz'

/** Parse a `datetime-local` string (`YYYY-MM-DDTHH:mm`) as wall time in `tz`. */
export function parseLocalDateTime(value: string, tz: string): Date {
  const [date, time = '00:00'] = value.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  // Wrap in a plain Date: TZDate overrides toISOString() with its offset format.
  return new Date(new TZDate(y, m - 1, d, hh, mm, tz).getTime())
}
