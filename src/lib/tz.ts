import { TZDate } from '@date-fns/tz'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Resolve a `yyyy-MM-dd` URL param to the anchor midnight of that calendar day
 * in the org timezone. The numeric-component constructor is required: passing a
 * bare `${date}T00:00:00` string to TZDate parses it in the SYSTEM timezone
 * (fixing the instant) then merely relabels the zone, so any negative-UTC-offset
 * org would render the wrong day/week. Invalid or missing params fall back to now.
 */
export function dayAnchor(dateParam: string | undefined | null, timezone: string): TZDate {
  if (dateParam && DATE_RE.test(dateParam)) {
    const [y, m, d] = dateParam.split('-').map(Number)
    return new TZDate(y, m - 1, d, timezone)
  }
  return new TZDate(new Date(), timezone)
}
