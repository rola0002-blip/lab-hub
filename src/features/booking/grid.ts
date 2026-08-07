// Pure time-grid math for the booking calendar: the week grid, the responsive
// day/schedule view, the booking dialog's time selects and the touch draft
// gesture all read rows from here. Client components import it, so it must stay
// dependency-light — no `server-only`, no React (the `issues/project-order.ts`
// posture); `date-fns` + `@date-fns/tz` are the only runtime imports.
//
// The grid is a fixed 07:00–23:00 band of half-hour rows. A row index is the
// number of half hours since 07:00, so row 0 = 07:00 and row ROWS (32) = 23:00 —
// ROWS is the EXCLUSIVE end of the band and a legal edge value, not a row that
// renders. Wall times are timezone-independent by construction: a row means the
// same clock reading in every org zone, and only the resulting instant differs.
import { TZDate } from '@date-fns/tz'
import { addDays, format } from 'date-fns'

export const START_HOUR = 7
export const END_HOUR = 23
export const ROWS = (END_HOUR - START_HOUR) * 2
// Row heights in px: the seven-column week grid is dense, the single-column day
// view is touch-sized (a 44px row clears the 44×44 tap target at half-hour
// granularity). Every geometry helper takes rowPx so neither view is hardcoded.
export const ROW_PX_WEEK = 22
export const ROW_PX_DAY = 44

// An in-progress selection on the grid. `endRow` is EXCLUSIVE, so the smallest
// draft is one row (30 minutes). Invariants held by every producer below:
// 0 <= startRow < endRow <= ROWS.
export type Draft = { day: number; startRow: number; endRow: number }

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

const MS_PER_ROW = 30 * 60_000

// Hour/minute of a row, as wall-clock components. Row ROWS lands on 23:00, which
// is still a valid same-day time, so no caller has to special-case the band end.
const rowHour = (row: number) => START_HOUR + Math.floor(row / 2)
const rowMinute = (row: number) => (row % 2) * 30

// The instant at `row` on the `day`-th day of the week starting at `weekStart`,
// resolved in the org zone. Moved verbatim from week-calendar.tsx (the TZDate
// wrap of `weekStart` is now inside, so callers may pass a plain Date).
export function rowToDate(weekStart: Date, day: number, row: number, timezone: string): Date {
  const d = addDays(new TZDate(weekStart, timezone), day)
  const t = new TZDate(d.getFullYear(), d.getMonth(), d.getDate(), rowHour(row), rowMinute(row), timezone)
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
// (`getBoundingClientRect().top`). Clamped to [0, ROWS] so a drag that leaves the
// column vertically pins to an edge instead of running off the band.
export function clientYToRow(clientY: number, columnTop: number, rowPx: number): number {
  return clamp(Math.floor((clientY - columnTop) / rowPx), 0, ROWS)
}

// A fresh one-hour draft anchored at the tapped row. Near the bottom of the band
// the seed slides UP rather than shrinking, so a tap always yields the same
// default duration.
export function seedDraft(day: number, row: number): Draft {
  const startRow = clamp(row, 0, ROWS - 2)
  return { day, startRow, endRow: startRow + 2 }
}

// Drag one edge of a draft to `row`. The edges never cross or meet: the dragged
// edge stops one row short, which is the minimum 30-minute booking.
export function resizeDraft(d: Draft, edge: 'start' | 'end', row: number): Draft {
  const r = clamp(row, 0, ROWS)
  return edge === 'start'
    ? { ...d, startRow: Math.min(r, d.endRow - 1) }
    : { ...d, endRow: Math.max(r, d.startRow + 1) }
}

// Drag the whole draft by `deltaRows`, preserving its length. At either end of
// the band the draft stops rather than compressing.
export function moveDraft(d: Draft, deltaRows: number): Draft {
  const length = d.endRow - d.startRow
  const startRow = clamp(d.startRow + deltaRows, 0, ROWS - length)
  return { ...d, startRow, endRow: startRow + length }
}

// 24-hour wall-clock label for a row edge, e.g. row 0 → '07:00', ROWS → '23:00'.
export function rowLabel(row: number): string {
  return `${String(rowHour(row)).padStart(2, '0')}:${String(rowMinute(row)).padStart(2, '0')}`
}

// The draft's range as a single en-dashed label, matching `formatRange`'s
// treatment in src/lib/time.ts.
export function draftLabel(d: Draft): string {
  return `${rowLabel(d.startRow)}–${rowLabel(d.endRow)}`
}

// Real instants for a 'yyyy-MM-dd' day plus a row pair, resolved in the org zone.
export function rowsToRange(
  dateStr: string,
  startRow: number,
  endRow: number,
  timezone: string,
): { start: Date; end: Date } {
  return {
    start: dateAtRow(dateStr, startRow, timezone),
    end: dateAtRow(dateStr, endRow, timezone),
  }
}

function dateAtRow(dateStr: string, row: number, timezone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(+new TZDate(y, m - 1, d, rowHour(row), rowMinute(row), timezone))
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
): { dateStr: string; startRow: number; endRow: number } {
  const s = new TZDate(start, timezone)
  const rawStart = (s.getHours() * 60 + s.getMinutes() - START_HOUR * 60) / 30
  const rawEnd = rawStart + (+end - +start) / MS_PER_ROW
  const startRow = clamp(Math.floor(rawStart), 0, ROWS - 1)
  return {
    dateStr: format(s, 'yyyy-MM-dd'),
    startRow,
    // Ceil so a range that is not row-aligned is covered, never truncated.
    endRow: clamp(Math.ceil(rawEnd), startRow + 1, ROWS),
  }
}

// The dialog's opening selection: the next :00/:30 at or after `now` in the org
// zone, for one hour. The last hour of the day shortens rather than spilling past
// 23:00; once the band has closed the selection rolls to 07:00 tomorrow, and
// before it opens it starts at 07:00 today.
export function defaultDialogRange(
  now: Date,
  timezone: string,
): { dateStr: string; startRow: number; endRow: number } {
  const local = new TZDate(now, timezone)
  const msSinceMidnight =
    ((local.getHours() * 60 + local.getMinutes()) * 60 + local.getSeconds()) * 1000 + local.getMilliseconds()
  const row = Math.ceil(msSinceMidnight / MS_PER_ROW) - START_HOUR * 2
  if (row >= ROWS) return { dateStr: format(addDays(local, 1), 'yyyy-MM-dd'), startRow: 0, endRow: 2 }
  const startRow = Math.max(row, 0)
  return { dateStr: format(local, 'yyyy-MM-dd'), startRow, endRow: Math.min(startRow + 2, ROWS) }
}
