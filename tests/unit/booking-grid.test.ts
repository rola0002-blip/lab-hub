import { describe, it, expect } from 'vitest'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import {
  START_HOUR, END_HOUR, ROWS, ROW_PX_WEEK, ROW_PX_DAY,
  rowToDate, slotRect, clientYToRow, seedDraft, resizeDraft, moveDraft,
  rowLabel, draftLabel, rowsToRange, rangeToRows, defaultDialogRange,
  type Draft,
} from '@/features/booking/grid'

const SG = 'Asia/Singapore'
const NY = 'America/New_York'

// The unit run pins process.env.TZ=UTC (vitest.config.ts), so every assertion
// below that reads a wall clock reads it back through the ORG zone — a helper
// that silently used the host zone would fail in both zones.
const hhmm = (d: Date, tz: string) => format(new TZDate(d, tz), 'HH:mm')
const dayKey = (d: Date, tz: string) => format(new TZDate(d, tz), 'yyyy-MM-dd')
// A real instant from org-zone wall-clock components (month is 0-based).
const at = (tz: string, y: number, m: number, d: number, h: number, min = 0) =>
  new Date(+new TZDate(y, m - 1, d, h, min, tz))

describe('grid constants', () => {
  it('spans 07:00–23:00 as 32 half-hour rows with distinct week and day row heights', () => {
    expect(START_HOUR).toBe(7)
    expect(END_HOUR).toBe(23)
    expect(ROWS).toBe(32)
    expect(ROW_PX_WEEK).toBe(22)
    expect(ROW_PX_DAY).toBe(44)
  })
})

describe('rowToDate', () => {
  // The same instant is a different calendar day in the two zones, which is the
  // point: the WALL time a row denotes is timezone-independent.
  const weekStart = new Date('2026-08-03T00:00:00.000Z')

  for (const tz of [SG, NY]) {
    it(`maps row 0 to 07:00 and row 31 to 22:30 in ${tz}`, () => {
      expect(hhmm(rowToDate(weekStart, 0, 0, tz), tz)).toBe('07:00')
      expect(hhmm(rowToDate(weekStart, 0, 31, tz), tz)).toBe('22:30')
    })
    it(`maps the exclusive end row ROWS to 23:00 in ${tz}`, () => {
      expect(hhmm(rowToDate(weekStart, 0, ROWS, tz), tz)).toBe('23:00')
    })
    it(`keeps the wall time across day offsets and advances the calendar day in ${tz}`, () => {
      const d0 = rowToDate(weekStart, 0, 6, tz)
      const d3 = rowToDate(weekStart, 3, 6, tz)
      expect(hhmm(d3, tz)).toBe(hhmm(d0, tz))
      expect(+d3 - +d0).toBe(3 * 86_400_000)
    })
  }

  it('resolves the same row to different instants in different zones', () => {
    expect(+rowToDate(weekStart, 0, 0, SG)).not.toBe(+rowToDate(weekStart, 0, 0, NY))
  })
})

describe('slotRect', () => {
  const weekStart = new Date('2026-08-03T00:00:00.000Z')
  const dayStart = rowToDate(weekStart, 0, 0, SG)
  const dayEnd = rowToDate(weekStart, 0, ROWS, SG)
  const slot = (start: Date, end: Date) => ({ startsAt: start.toISOString(), endsAt: end.toISOString() })
  const day = dayKey(dayStart, SG)
  const [y, m, d] = day.split('-').map(Number)

  it('returns null for a slot that ends before the day band opens', () => {
    expect(slotRect(slot(at(SG, y, m, d, 4), at(SG, y, m, d, 6)), dayStart, dayEnd, ROW_PX_WEEK)).toBeNull()
  })
  it('returns null for a slot that starts after the day band closes', () => {
    expect(slotRect(slot(at(SG, y, m, d, 23), at(SG, y, m, d + 1, 1)), dayStart, dayEnd, ROW_PX_WEEK)).toBeNull()
  })
  it('returns null for a slot on an entirely different day', () => {
    expect(slotRect(slot(at(SG, y, m, d + 2, 9), at(SG, y, m, d + 2, 11)), dayStart, dayEnd, ROW_PX_WEEK)).toBeNull()
  })
  it('places an in-band slot at its row offset and height', () => {
    // 09:00–11:00 = 4 rows down, 4 rows tall.
    const r = slotRect(slot(at(SG, y, m, d, 9), at(SG, y, m, d, 11)), dayStart, dayEnd, ROW_PX_WEEK)
    expect(r).toEqual({ top: 4 * ROW_PX_WEEK, height: 4 * ROW_PX_WEEK })
  })
  it('clamps an overnight range into the 07:00–23:00 band at both edges', () => {
    // Yesterday 22:00 → today 09:00 clamps its top to the band open.
    const early = slotRect(slot(at(SG, y, m, d - 1, 22), at(SG, y, m, d, 9)), dayStart, dayEnd, ROW_PX_WEEK)
    expect(early).toEqual({ top: 0, height: 4 * ROW_PX_WEEK })
    // Today 22:00 → tomorrow 01:00 clamps its bottom to the band close.
    const late = slotRect(slot(at(SG, y, m, d, 22), at(SG, y, m, d + 1, 1)), dayStart, dayEnd, ROW_PX_WEEK)
    expect(late).toEqual({ top: 30 * ROW_PX_WEEK, height: 2 * ROW_PX_WEEK })
  })
  it('floors the rendered height at 10px so a very short slot stays visible', () => {
    const r = slotRect(slot(at(SG, y, m, d, 9), at(SG, y, m, d, 9, 5)), dayStart, dayEnd, ROW_PX_WEEK)
    // 5 minutes at 22px/30min would be ~3.7px.
    expect(r?.height).toBe(10)
  })
  it('scales top and height with rowPx (22 week vs 44 day)', () => {
    const s = slot(at(SG, y, m, d, 9), at(SG, y, m, d, 11))
    const week = slotRect(s, dayStart, dayEnd, ROW_PX_WEEK)!
    const dayView = slotRect(s, dayStart, dayEnd, ROW_PX_DAY)!
    expect(dayView.top).toBe(week.top * 2)
    expect(dayView.height).toBe(week.height * 2)
  })
})

describe('clientYToRow', () => {
  it('floors the pointer offset into a row index', () => {
    expect(clientYToRow(100, 100, ROW_PX_WEEK)).toBe(0)
    expect(clientYToRow(121, 100, ROW_PX_WEEK)).toBe(0)
    expect(clientYToRow(122, 100, ROW_PX_WEEK)).toBe(1)
    expect(clientYToRow(100 + 5 * ROW_PX_DAY + 43, 100, ROW_PX_DAY)).toBe(5)
  })
  it('clamps above the column top to row 0 and below the column to ROWS', () => {
    expect(clientYToRow(0, 100, ROW_PX_WEEK)).toBe(0)
    expect(clientYToRow(-500, 100, ROW_PX_WEEK)).toBe(0)
    expect(clientYToRow(100 + 999 * ROW_PX_WEEK, 100, ROW_PX_WEEK)).toBe(ROWS)
  })
})

describe('seedDraft', () => {
  it('seeds a one-hour (2-row) draft at the tapped row', () => {
    expect(seedDraft(3, 8)).toEqual({ day: 3, startRow: 8, endRow: 10 })
  })
  it('slides the seed up so the last hour of the day still fits', () => {
    expect(seedDraft(0, 31)).toEqual({ day: 0, startRow: 30, endRow: 32 })
    expect(seedDraft(0, ROWS)).toEqual({ day: 0, startRow: 30, endRow: 32 })
  })
})

describe('resizeDraft', () => {
  const d: Draft = { day: 2, startRow: 10, endRow: 14 }

  it('moves the requested edge and leaves the other untouched', () => {
    expect(resizeDraft(d, 'start', 8)).toEqual({ day: 2, startRow: 8, endRow: 14 })
    expect(resizeDraft(d, 'end', 20)).toEqual({ day: 2, startRow: 10, endRow: 20 })
  })
  it('never lets the start edge reach or cross the end edge', () => {
    expect(resizeDraft(d, 'start', 14)).toEqual({ day: 2, startRow: 13, endRow: 14 })
    expect(resizeDraft(d, 'start', 30)).toEqual({ day: 2, startRow: 13, endRow: 14 })
  })
  it('never lets the end edge reach or cross the start edge', () => {
    expect(resizeDraft(d, 'end', 10)).toEqual({ day: 2, startRow: 10, endRow: 11 })
    expect(resizeDraft(d, 'end', 2)).toEqual({ day: 2, startRow: 10, endRow: 11 })
  })
  it('clamps either edge into the [0, ROWS] band', () => {
    expect(resizeDraft(d, 'start', -9)).toEqual({ day: 2, startRow: 0, endRow: 14 })
    expect(resizeDraft(d, 'end', 99)).toEqual({ day: 2, startRow: 10, endRow: ROWS })
  })
})

describe('moveDraft', () => {
  const d: Draft = { day: 1, startRow: 10, endRow: 14 }

  it('shifts both edges by the delta, preserving length and day', () => {
    expect(moveDraft(d, 3)).toEqual({ day: 1, startRow: 13, endRow: 17 })
    expect(moveDraft(d, -4)).toEqual({ day: 1, startRow: 6, endRow: 10 })
    expect(moveDraft(d, 0)).toEqual(d)
  })
  it('clamps at the top of the band without shrinking the draft', () => {
    expect(moveDraft(d, -99)).toEqual({ day: 1, startRow: 0, endRow: 4 })
  })
  it('clamps at the bottom of the band without shrinking the draft', () => {
    expect(moveDraft(d, 99)).toEqual({ day: 1, startRow: ROWS - 4, endRow: ROWS })
  })
})

describe('rowLabel and draftLabel', () => {
  it('labels row 0 as 07:00, odd rows as the half hour, and row ROWS as 23:00', () => {
    expect(rowLabel(0)).toBe('07:00')
    expect(rowLabel(1)).toBe('07:30')
    expect(rowLabel(5)).toBe('09:30')
    expect(rowLabel(31)).toBe('22:30')
    expect(rowLabel(ROWS)).toBe('23:00')
  })
  it('joins a draft into an en-dashed start–end range', () => {
    expect(draftLabel({ day: 0, startRow: 4, endRow: 6 })).toBe('09:00–10:00')
    expect(draftLabel({ day: 6, startRow: 30, endRow: ROWS })).toBe('22:00–23:00')
  })
})

describe('rowsToRange and rangeToRows', () => {
  for (const tz of [SG, NY]) {
    it(`turns a date string plus rows into real instants at the org wall clock in ${tz}`, () => {
      const { start, end } = rowsToRange('2026-08-05', 4, 8, tz)
      expect(hhmm(start, tz)).toBe('09:00')
      expect(hhmm(end, tz)).toBe('11:00')
      expect(dayKey(start, tz)).toBe('2026-08-05')
    })
    it(`round-trips rows → instants → rows in ${tz}`, () => {
      const { start, end } = rowsToRange('2026-08-05', 4, 8, tz)
      expect(rangeToRows(start, end, tz)).toEqual({ dateStr: '2026-08-05', startRow: 4, endRow: 8 })
    })
    it(`round-trips the band edges (row 0 and row ROWS) in ${tz}`, () => {
      const { start, end } = rowsToRange('2026-08-05', 0, ROWS, tz)
      expect(rangeToRows(start, end, tz)).toEqual({ dateStr: '2026-08-05', startRow: 0, endRow: ROWS })
    })
  }

  it('reads the calendar day in the org zone, not the host or UTC zone', () => {
    // 22:00 in Singapore on 5 Aug is still 14:00 UTC the same day, but 23:00 in
    // New York on 5 Aug is 03:00 UTC on 6 Aug — the org zone must decide.
    const { start, end } = rowsToRange('2026-08-05', 30, ROWS, NY)
    expect(rangeToRows(start, end, NY).dateStr).toBe('2026-08-05')
    expect(dayKey(start, 'UTC')).toBe('2026-08-06')
  })

  it('clamps an entirely out-of-band range into [0, ROWS] rather than returning negative rows', () => {
    const rows = rangeToRows(at(SG, 2026, 8, 5, 3), at(SG, 2026, 8, 5, 5), SG)
    expect(rows.dateStr).toBe('2026-08-05')
    expect(rows.startRow).toBeGreaterThanOrEqual(0)
    expect(rows.endRow).toBeLessThanOrEqual(ROWS)
    expect(rows.endRow).toBeGreaterThan(rows.startRow)
    expect(rows).toEqual({ dateStr: '2026-08-05', startRow: 0, endRow: 1 })
  })

  it('clamps an overnight range to the close of its starting day', () => {
    const rows = rangeToRows(at(SG, 2026, 8, 5, 22), at(SG, 2026, 8, 6, 1), SG)
    expect(rows).toEqual({ dateStr: '2026-08-05', startRow: 30, endRow: ROWS })
  })
})

describe('defaultDialogRange', () => {
  it('picks the next half hour strictly after a mid-slot time, for one hour', () => {
    // 09:10 → 09:30–10:30.
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 9, 10), SG))
      .toEqual({ dateStr: '2026-08-05', startRow: 5, endRow: 7 })
  })
  it('keeps an exact half-hour boundary (at-or-after includes the boundary)', () => {
    // 09:00 → 09:00–10:00, not 09:30.
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 9), SG))
      .toEqual({ dateStr: '2026-08-05', startRow: 4, endRow: 6 })
  })
  it('shortens the last slot of the day rather than spilling past 23:00', () => {
    // 22:20 → 22:30–23:00, a 30-minute default.
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 22, 20), SG))
      .toEqual({ dateStr: '2026-08-05', startRow: 31, endRow: ROWS })
  })
  it('rolls to tomorrow at 07:00 once the next slot is past the end of the band', () => {
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 23, 40), SG))
      .toEqual({ dateStr: '2026-08-06', startRow: 0, endRow: 2 })
    // Exactly 23:00 is already the closing edge — the next bookable slot is tomorrow.
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 23), SG))
      .toEqual({ dateStr: '2026-08-06', startRow: 0, endRow: 2 })
  })
  it('opens at 07:00 today when the day has not started yet', () => {
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 6), SG))
      .toEqual({ dateStr: '2026-08-05', startRow: 0, endRow: 2 })
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 0, 5), SG))
      .toEqual({ dateStr: '2026-08-05', startRow: 0, endRow: 2 })
  })
  it('resolves "now" in the org zone, so the same instant differs by zone', () => {
    // 2026-08-05 09:10 in Singapore is 2026-08-04 21:10 in New York: a different
    // calendar day AND past the band, so New York rolls to its own tomorrow.
    const now = at(SG, 2026, 8, 5, 9, 10)
    expect(defaultDialogRange(now, SG)).toEqual({ dateStr: '2026-08-05', startRow: 5, endRow: 7 })
    expect(defaultDialogRange(now, NY)).toEqual({ dateStr: '2026-08-04', startRow: 29, endRow: 31 })
  })
  it('rounds a time carrying seconds up to the next half hour', () => {
    const now = new Date(+at(SG, 2026, 8, 5, 9) + 30_000)
    expect(defaultDialogRange(now, SG)).toEqual({ dateStr: '2026-08-05', startRow: 5, endRow: 7 })
  })
})
