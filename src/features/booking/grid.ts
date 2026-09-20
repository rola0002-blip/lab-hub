// Pure time-grid math for the booking calendar: the week grid, the responsive
// day/schedule view, the booking dialog's time selects and the touch draft
// gesture all read rows from here. Client components import it, so it must stay
// dependency-light — no `server-only`, no React (the `issues/project-order.ts`
// posture); `date-fns` + `@date-fns/tz` (+ the equally pure `lib/wall-time`)
// are the only runtime imports.
//
// The grid is a BAND of half-hour rows derived from the equipment's daily
// access window (see `bandFor`): a row index is the number of half hours since
// the band's start hour, so row 0 is the band open and row bandRows(band) its
// EXCLUSIVE close — a legal edge value, not a row that renders. Wall times are
// timezone-independent by construction: a row means the same clock reading in
// every org zone, and only the resulting instant differs. Rows beyond the band
// close are meaningful ONLY as dialog END edges (an overnight run's 06:00 is
// row bandRows+12 on a 24 h band); the TZDate constructor rolls the excess
// hours into the next calendar day, and `rowLabel` wraps past 24:00.
import { TZDate } from '@date-fns/tz'
import { addDays, format } from 'date-fns'
import { sameOrgDay, wallMinutes } from '@/lib/wall-time'

// The visible/renderable hour range: `startHour` inclusive, `endHour` the
// exclusive close (23 = closes 23:00; 24 = closes at midnight).
export type Band = { startHour: number; endHour: number }

export const ROW_PX_WEEK = 22
export const ROW_PX_DAY = 44

/** Half-hour rows in a band — the dynamic replacement for the old ROWS const. */
export const bandRows = (band: Band): number => (band.endHour - band.startHour) * 2

/** Rendering band: the equipment's access window, expanded to include every
 *  visible booking (legacy off-band rows must never be invisible again).
 *  A booking that crosses midnight in the org zone opens the close to 24:00
 *  (its start-day slice reaches midnight); when it also leaves a tail past
 *  00:00 the band opens to the full day, so the tail renders on its end day. */
export function bandFor(
  eq: { accessStartMinutes: number; accessEndMinutes: number },
  bookings: Array<{ startsAt: Date; endsAt: Date }>,
  tz = 'UTC',
): Band {
  let startHour = Math.floor(eq.accessStartMinutes / 60)
  let endHour = Math.min(24, Math.ceil(eq.accessEndMinutes / 60))
  for (const b of bookings) {
    if (sameOrgDay(b.startsAt, b.endsAt, tz)) {
      startHour = Math.min(startHour, Math.floor(wallMinutes(b.startsAt, tz).min / 60))
      endHour = Math.max(endHour, Math.min(24, Math.ceil(wallMinutes(b.endsAt, tz).min / 60)))
    } else {
      endHour = 24
      if (wallMinutes(b.endsAt, tz).min > 0) startHour = 0
    }
  }
  return { startHour: Math.max(0, startHour), endHour }
}

// An in-progress selection on the grid. `endRow` is EXCLUSIVE, so the smallest
// draft is one row (30 minutes). Invariants held by every producer below:
// 0 <= startRow < endRow <= bandRows(band).
export type Draft = { day: number; startRow: number; endRow: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

const MS_PER_ROW = 30 * 60_000

// Hour/minute of a row, as wall-clock components. Row bandRows(band) lands on
// the closing hour, which is still a valid same-day time (or midnight when the
// band closes at 24), so no caller has to special-case the band end.
const rowHour = (row: number, band: Band) => band.startHour + Math.floor(row / 2)
const rowMinute = (row: number) => (row % 2) * 30

// The instant at `row` on the `day`-th day of the week starting at `weekStart`,
// resolved in the org zone. Moved verbatim from week-calendar.tsx (the TZDate
// wrap of `weekStart` is now inside, so callers may pass a plain Date).
export function rowToDate(weekStart: Date, day: number, row: number, timezone: string, band: Band): Date {
  const d = addDays(new TZDate(weekStart, timezone), day)
  const t = new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), rowHour(row, band), rowMinute(row), timezone)
  return new Date(+t)
}

// Pixel geometry for a slot inside one day column, or null when the slot does
// not intersect the visible band at all. A range that spills past either edge is
// clamped to the band, and the height is floored at 10px so a very short booking
// stays legible. Moved verbatim from week-calendar.tsx with `rowPx` parameterised
// and the day bounds hoisted to arguments (the caller computes them once).
export function slotRect(
  s: { startsAt: string; endsAt: string },
  dayStart: Date,
  dayEnd: Date,
  rowPx: number,
): { top: number; height: number } | null {
  const a = new Date(s.startsAt), b = new Date(s.endsAt)
  if (b <= dayStart || a >= dayEnd) return null
  const clampA = Math.max(+a, +dayStart), clampB = Math.min(+b, +dayEnd)
  const top = ((clampA - +dayStart) / 60_000 / 30) * rowPx
  return { top, height: Math.max(((clampB - clampA) / 60_000 / 30) * rowPx, 10) }
}

// Row under a pointer, from a viewport Y and the column's own viewport top
// (`getBoundingClientRect().top`). Clamped to [0, bandRows] so a drag that
// leaves the column vertically pins to an edge instead of running off the band.
export function clientYToRow(clientY: number, columnTop: number, rowPx: number, band: Band): number {
  return clamp(Math.floor((clientY - columnTop) / rowPx), 0, bandRows(band))
}

// A fresh one-hour draft anchored at the tapped row. Near the bottom of the band
// the seed slides UP rather than shrinking, so a tap always yields the same
// default duration.
export function seedDraft(day: number, row: number, band: Band): Draft {
  const startRow = clamp(row, 0, bandRows(band) - 2)
  return { day, startRow, endRow: startRow + 2 }
}

// Drag one edge of a draft to `row`. The edges never cross or meet: the dragged
// edge stops one row short, which is the minimum 30-minute booking.
export function resizeDraft(d: Draft, edge: 'start' | 'end', row: number, band: Band): Draft {
  const r = clamp(row, 0, bandRows(band))
  return edge === 'start'
    ? { ...d, startRow: Math.min(r, d.endRow - 1) }
    : { ...d, endRow: Math.max(r, d.startRow + 1) }
}

// Drag the whole draft by `deltaRows`, preserving its length. At either end of
// the band the draft stops rather than compressing.
export function moveDraft(d: Draft, deltaRows: number, band: Band): Draft {
  const length = d.endRow - d.startRow
  const startRow = clamp(d.startRow + deltaRows, 0, bandRows(band) - length)
  return { ...d, startRow, endRow: startRow + length }
}

// 24-hour wall-clock label for a row edge, e.g. row 0 on a 7..23 band →
// '07:00', bandRows → '23:00'. Rows past the band close wrap past midnight
// (hour 26 → '02:00') so an overnight dialog END edge still reads as a clock
// time — the option list it sits in is strictly increasing after `From`.
export function rowLabel(row: number, band: Band): string {
  const h = rowHour(row, band)
  return `${String(h % 24).padStart(2, '0')}:${String(rowMinute(row)).padStart(2, '0')}`
}

// The draft's range as a single en-dashed label, matching `formatRange`'s
// treatment in src/lib/time.ts.
export function draftLabel(d: Draft, band: Band): string {
  return `${rowLabel(d.startRow, band)}–${rowLabel(d.endRow, band)}`
}

// Real instants for a 'yyyy-MM-dd' day plus a row pair, resolved in the org
// zone. `endRow` may exceed the band close: the excess hours roll into the next
// day (the overnight-booking representation the dialog's To select produces).
export function rowsToRange(
  dateStr: string,
  startRow: number,
  endRow: number,
  timezone: string,
  band: Band,
): { start: Date; end: Date } {
  return {
    start: dateAtRow(dateStr, startRow, timezone, band),
    end: dateAtRow(dateStr, endRow, timezone, band),
  }
}

function dateAtRow(dateStr: string, row: number, timezone: string, band: Band): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(+new TZDate(y, m - 1, d, rowHour(row, band), rowMinute(row), timezone))
}

// The inverse of `rowsToRange`: the org-zone day of `start` plus the rows that
// cover [start, end). Rows are derived from the ELAPSED duration rather than the
// end's own wall clock, so an overnight booking clamps to the close of its
// starting day instead of wrapping to a negative row. Out-of-band input degrades
// to the nearest legal, non-empty selection (a booking made before this band
// existed, or edited outside it, must still open in the dialog).
export function rangeToRows(
  start: Date,
  end: Date,
  timezone: string,
  band: Band,
): { dateStr: string; startRow: number; endRow: number } {
  const s = new TZDate(start, timezone)
  const rows = bandRows(band)
  const rawStart = (s.getHours() * 60 + s.getMinutes() - band.startHour * 60) / 30
  const rawEnd = rawStart + (+end - +start) / MS_PER_ROW
  const startRow = clamp(Math.floor(rawStart), 0, rows - 1)
  return {
    dateStr: format(s, 'yyyy-MM-dd'),
    startRow,
    // Ceil so a range that is not row-aligned is covered, never truncated.
    endRow: clamp(Math.ceil(rawEnd), startRow + 1, rows),
  }
}

// The dialog's opening selection: the next :00/:30 at or after `now` in the org
// zone, for one hour. The last hour of the band shortens rather than spilling
// past the close; once the band has closed the selection rolls to the band open
// tomorrow, and before it opens it starts at the band open today.
export function defaultDialogRange(
  now: Date,
  timezone: string,
  band: Band,
): { dateStr: string; startRow: number; endRow: number } {
  const local = new TZDate(now, timezone)
  const rows = bandRows(band)
  const msSinceMidnight =
    ((local.getHours() * 60 + local.getMinutes()) * 60 + local.getSeconds()) * 1000 + local.getMilliseconds()
  const row = Math.ceil(msSinceMidnight / MS_PER_ROW) - band.startHour * 2
  if (row >= rows) return { dateStr: format(addDays(local, 1), 'yyyy-MM-dd'), startRow: 0, endRow: 2 }
  const startRow = Math.max(row, 0)
  return { dateStr: format(local, 'yyyy-MM-dd'), startRow, endRow: Math.min(startRow + 2, rows) }
}
