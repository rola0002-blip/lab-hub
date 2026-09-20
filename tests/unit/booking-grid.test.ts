import { describe, it, expect } from 'vitest'
import { TZDate } from '@date-fns/tz'
import { format } from 'date-fns'
import {
  Band, ROW_PX_WEEK, ROW_PX_DAY, bandFor, bandRows,
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

// The legacy fixed band (07:00–23:00), now just one parameterisation: the tests
// below pin it so the row math keeps its historical meaning, and the DAY band
// proves the helpers are genuinely band-driven.
const BAND: Band = { startHour: 7, endHour: 23 }
const ROWS = bandRows(BAND)
const FULL: Band = { startHour: 0, endHour: 24 }

describe('bandFor', () => {
  it('band defaults to the equipment window', () => {
    expect(bandFor({ accessStartMinutes: 420, accessEndMinutes: 1380 }, [])).toEqual({ startHour: 7, endHour: 23 })
  })
  it('24h window yields 0..24', () => {
    expect(bandFor({ accessStartMinutes: 0, accessEndMinutes: 1439 }, [])).toEqual({ startHour: 0, endHour: 24 })
  })
  it('band expands to include a legacy overnight booking', () => {
    expect(bandFor({ accessStartMinutes: 420, accessEndMinutes: 1380 },
      [{ startsAt: new Date('2026-09-21T16:00:00Z'), endsAt: new Date('2026-09-22T02:00:00Z') }])).toEqual({ startHour: 0, endHour: 24 })
  })
  it('expands only the touched edge for a same-day off-band booking', () => {
    // A legacy 06:00→09:00 run widens the morning edge but leaves the evening close alone.
    expect(bandFor({ accessStartMinutes: 420, accessEndMinutes: 1380 },
      [{ startsAt: new Date('2026-09-21T06:00:00Z'), endsAt: new Date('2026-09-21T09:00:00Z') }])).toEqual({ startHour: 6, endHour: 23 })
    // …and a late run past 23:00 widens the close to midnight.
    expect(bandFor({ accessStartMinutes: 420, accessEndMinutes: 1380 },
      [{ startsAt: new Date('2026-09-21T22:00:00Z'), endsAt: new Date('2026-09-22T00:00:00Z') }])).toEqual({ startHour: 7, endHour: 24 })
  })
  it('never expands past 0..24, whatever the bookings claim', () => {
    expect(bandFor({ accessStartMinutes: 0, accessEndMinutes: 1439 },
      [{ startsAt: new Date('2026-09-21T23:00:00Z'), endsAt: new Date('2026-09-21T23:59:00Z') }])).toEqual({ startHour: 0, endHour: 24 })
  })
})

describe('grid constants', () => {
  it('bands measure as half-hour rows with distinct week and day row heights', () => {
    expect(ROWS).toBe(32)
    expect(bandRows(FULL)).toBe(48)
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
      expect(hhmm(rowToDate(weekStart, 0, 0, tz, BAND), tz)).toBe('07:00')
      expect(hhmm(rowToDate(weekStart, 0, 31, tz, BAND), tz)).toBe('22:30')
    })
    it(`maps the exclusive end row ROWS to 23:00 in ${tz}`, () => {
      expect(hhmm(rowToDate(weekStart, 0, ROWS, tz, BAND), tz)).toBe('23:00')
    })
    it(`keeps the wall time across day offsets and advances the calendar day in ${tz}`, () => {
      const d0 = rowToDate(weekStart, 0, 6, tz, BAND)
      const d3 = rowToDate(weekStart, 3, 6, tz, BAND)
      expect(hhmm(d3, tz)).toBe(hhmm(d0, tz))
      expect(+d3 - +d0).toBe(3 * 86_400_000)
    })
  }

  it('resolves the same row to different instants in different zones', () => {
    expect(+rowToDate(weekStart, 0, 0, SG, BAND)).not.toBe(+rowToDate(weekStart, 0, 0, NY, BAND))
  })

  it('on a 24h band, the close row is midnight of the NEXT day', () => {
    const close = rowToDate(weekStart, 0, bandRows(FULL), SG, FULL)
    expect(hhmm(close, SG)).toBe('00:00')
    expect(dayKey(close, SG)).toBe(dayKey(rowToDate(weekStart, 1, 0, SG, FULL), SG))
  })
})

describe('slotRect', () => {
  const weekStart = new Date('2026-08-03T00:00:00.000Z')
  const dayStart = rowToDate(weekStart, 0, 0, SG, BAND)
  const dayEnd = rowToDate(weekStart, 0, ROWS, SG, BAND)
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
    expect(clientYToRow(100, 100, ROW_PX_WEEK, BAND)).toBe(0)
    expect(clientYToRow(121, 100, ROW_PX_WEEK, BAND)).toBe(0)
    expect(clientYToRow(122, 100, ROW_PX_WEEK, BAND)).toBe(1)
    expect(clientYToRow(100 + 5 * ROW_PX_DAY + 43, 100, ROW_PX_DAY, BAND)).toBe(5)
  })
  it('clamps above the column top to row 0 and below the column to the band close', () => {
    expect(clientYToRow(0, 100, ROW_PX_WEEK, BAND)).toBe(0)
    expect(clientYToRow(-500, 100, ROW_PX_WEEK, BAND)).toBe(0)
    expect(clientYToRow(100 + 999 * ROW_PX_WEEK, 100, ROW_PX_WEEK, BAND)).toBe(ROWS)
    expect(clientYToRow(100 + 999 * ROW_PX_DAY, 100, ROW_PX_DAY, FULL)).toBe(bandRows(FULL))
  })
})

describe('seedDraft', () => {
  it('seeds a one-hour (2-row) draft at the tapped row', () => {
    expect(seedDraft(3, 8, BAND)).toEqual({ day: 3, startRow: 8, endRow: 10 })
  })
  it('slides the seed up so the last hour of the day still fits', () => {
    expect(seedDraft(0, 31, BAND)).toEqual({ day: 0, startRow: 30, endRow: 32 })
    expect(seedDraft(0, ROWS, BAND)).toEqual({ day: 0, startRow: 30, endRow: 32 })
    expect(seedDraft(0, bandRows(FULL), FULL)).toEqual({ day: 0, startRow: 46, endRow: 48 })
  })
})

describe('resizeDraft', () => {
  const d: Draft = { day: 2, startRow: 10, endRow: 14 }

  it('moves the requested edge and leaves the other untouched', () => {
    expect(resizeDraft(d, 'start', 8, BAND)).toEqual({ day: 2, startRow: 8, endRow: 14 })
    expect(resizeDraft(d, 'end', 20, BAND)).toEqual({ day: 2, startRow: 10, endRow: 20 })
  })
  it('never lets the start edge reach or cross the end edge', () => {
    expect(resizeDraft(d, 'start', 14, BAND)).toEqual({ day: 2, startRow: 13, endRow: 14 })
    expect(resizeDraft(d, 'start', 30, BAND)).toEqual({ day: 2, startRow: 13, endRow: 14 })
  })
  it('never lets the end edge reach or cross the start edge', () => {
    expect(resizeDraft(d, 'end', 10, BAND)).toEqual({ day: 2, startRow: 10, endRow: 11 })
    expect(resizeDraft(d, 'end', 2, BAND)).toEqual({ day: 2, startRow: 10, endRow: 11 })
  })
  it('clamps either edge into the [0, bandRows] band', () => {
    expect(resizeDraft(d, 'start', -9, BAND)).toEqual({ day: 2, startRow: 0, endRow: 14 })
    expect(resizeDraft(d, 'end', 99, BAND)).toEqual({ day: 2, startRow: 10, endRow: ROWS })
    expect(resizeDraft(d, 'end', 99, FULL)).toEqual({ day: 2, startRow: 10, endRow: bandRows(FULL) })
  })
})

describe('moveDraft', () => {
  const d: Draft = { day: 1, startRow: 10, endRow: 14 }

  it('shifts both edges by the delta, preserving length and day', () => {
    expect(moveDraft(d, 3, BAND)).toEqual({ day: 1, startRow: 13, endRow: 17 })
    expect(moveDraft(d, -4, BAND)).toEqual({ day: 1, startRow: 6, endRow: 10 })
    expect(moveDraft(d, 0, BAND)).toEqual(d)
  })
  it('clamps at the top of the band without shrinking the draft', () => {
    expect(moveDraft(d, -99, BAND)).toEqual({ day: 1, startRow: 0, endRow: 4 })
  })
  it('clamps at the bottom of the band without shrinking the draft', () => {
    expect(moveDraft(d, 99, BAND)).toEqual({ day: 1, startRow: ROWS - 4, endRow: ROWS })
    expect(moveDraft(d, 99, FULL)).toEqual({ day: 1, startRow: bandRows(FULL) - 4, endRow: bandRows(FULL) })
  })
})

describe('rowLabel and draftLabel', () => {
  it('labels row 0 as 07:00, odd rows as the half hour, and row ROWS as 23:00', () => {
    expect(rowLabel(0, BAND)).toBe('07:00')
    expect(rowLabel(1, BAND)).toBe('07:30')
    expect(rowLabel(5, BAND)).toBe('09:30')
    expect(rowLabel(31, BAND)).toBe('22:30')
    expect(rowLabel(ROWS, BAND)).toBe('23:00')
  })
  it('wraps labels past midnight for overnight end edges', () => {
    expect(rowLabel(bandRows(FULL), FULL)).toBe('00:00')
    expect(rowLabel(bandRows(FULL) + 12, FULL)).toBe('06:00')
    expect(rowLabel(bandRows(BAND) + 1, BAND)).toBe('23:30')
    expect(rowLabel(bandRows(BAND) + 3, BAND)).toBe('00:30')
  })
  it('joins a draft into an en-dashed start–end range', () => {
    expect(draftLabel({ day: 0, startRow: 4, endRow: 6 }, BAND)).toBe('09:00–10:00')
    expect(draftLabel({ day: 6, startRow: 30, endRow: ROWS }, BAND)).toBe('22:00–23:00')
  })
})

describe('rowsToRange and rangeToRows', () => {
  for (const tz of [SG, NY]) {
    it(`turns a date string plus rows into real instants at the org wall clock in ${tz}`, () => {
      const { start, end } = rowsToRange('2026-08-05', 4, 8, tz, BAND)
      expect(hhmm(start, tz)).toBe('09:00')
      expect(hhmm(end, tz)).toBe('11:00')
      expect(dayKey(start, tz)).toBe('2026-08-05')
    })
    it(`round-trips rows → instants → rows in ${tz}`, () => {
      const { start, end } = rowsToRange('2026-08-05', 4, 8, tz, BAND)
      expect(rangeToRows(start, end, tz, BAND)).toEqual({ dateStr: '2026-08-05', startRow: 4, endRow: 8 })
    })
    it(`round-trips the band edges (row 0 and row ROWS) in ${tz}`, () => {
      const { start, end } = rowsToRange('2026-08-05', 0, ROWS, tz, BAND)
      expect(rangeToRows(start, end, tz, BAND)).toEqual({ dateStr: '2026-08-05', startRow: 0, endRow: ROWS })
    })
  }

  it('reads the calendar day in the org zone, not the host or UTC zone', () => {
    // 22:00 in Singapore on 5 Aug is still 14:00 UTC the same day, but 23:00 in
    // New York on 5 Aug is 03:00 UTC on 6 Aug — the org zone must decide.
    const { start, end } = rowsToRange('2026-08-05', 30, ROWS, NY, BAND)
    expect(rangeToRows(start, end, NY, BAND).dateStr).toBe('2026-08-05')
    expect(dayKey(start, 'UTC')).toBe('2026-08-06')
  })

  it('resolves overnight rows (past the band close) into the next org day', () => {
    // The dialog's To select produces endRow 60 on a 24h band: 20:00 → 06:00+1.
    const { start, end } = rowsToRange('2026-08-05', 40, 60, SG, FULL)
    expect(hhmm(start, SG)).toBe('20:00')
    expect(dayKey(start, SG)).toBe('2026-08-05')
    expect(hhmm(end, SG)).toBe('06:00')
    expect(dayKey(end, SG)).toBe('2026-08-06')
  })

  it('clamps an entirely out-of-band range into [0, ROWS] rather than returning negative rows', () => {
    const rows = rangeToRows(at(SG, 2026, 8, 5, 3), at(SG, 2026, 8, 5, 5), SG, BAND)
    expect(rows.dateStr).toBe('2026-08-05')
    expect(rows.startRow).toBeGreaterThanOrEqual(0)
    expect(rows.endRow).toBeLessThanOrEqual(ROWS)
    expect(rows.endRow).toBeGreaterThan(rows.startRow)
    expect(rows).toEqual({ dateStr: '2026-08-05', startRow: 0, endRow: 1 })
  })

  it('clamps an overnight range to the close of its starting day', () => {
    const rows = rangeToRows(at(SG, 2026, 8, 5, 22), at(SG, 2026, 8, 6, 1), SG, BAND)
    expect(rows).toEqual({ dateStr: '2026-08-05', startRow: 30, endRow: ROWS })
  })
})

describe('defaultDialogRange', () => {
  it('picks the next half hour strictly after a mid-slot time, for one hour', () => {
    // 09:10 → 09:30–10:30.
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 9, 10), SG, BAND))
      .toEqual({ dateStr: '2026-08-05', startRow: 5, endRow: 7 })
  })
  it('keeps an exact half-hour boundary (at-or-after includes the boundary)', () => {
    // 09:00 → 09:00–10:00, not 09:30.
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 9), SG, BAND))
      .toEqual({ dateStr: '2026-08-05', startRow: 4, endRow: 6 })
  })
  it('shortens the last slot of the day rather than spilling past 23:00', () => {
    // 22:20 → 22:30–23:00, a 30-minute default.
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 22, 20), SG, BAND))
      .toEqual({ dateStr: '2026-08-05', startRow: 31, endRow: ROWS })
  })
  it('rolls to tomorrow at 07:00 once the next slot is past the end of the band', () => {
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 23, 40), SG, BAND))
      .toEqual({ dateStr: '2026-08-06', startRow: 0, endRow: 2 })
    // Exactly 23:00 is already the closing edge — the next bookable slot is tomorrow.
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 23), SG, BAND))
      .toEqual({ dateStr: '2026-08-06', startRow: 0, endRow: 2 })
  })
  it('opens at 07:00 today when the day has not started yet', () => {
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 6), SG, BAND))
      .toEqual({ dateStr: '2026-08-05', startRow: 0, endRow: 2 })
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 0, 5), SG, BAND))
      .toEqual({ dateStr: '2026-08-05', startRow: 0, endRow: 2 })
  })
  it('on a 24h band, 23:10 is still bookable today and only midnight rolls over', () => {
    expect(defaultDialogRange(at(SG, 2026, 8, 5, 23, 10), SG, FULL))
      .toEqual({ dateStr: '2026-08-05', startRow: 47, endRow: bandRows(FULL) })
    expect(defaultDialogRange(at(SG, 2026, 8, 6, 0), SG, FULL))
      .toEqual({ dateStr: '2026-08-06', startRow: 0, endRow: 2 })
  })
  it('resolves "now" in the org zone, so the same instant differs by zone', () => {
    // 2026-08-05 09:10 in Singapore is 2026-08-04 21:10 in New York: a different
    // calendar day AND past the band, so New York rolls to its own tomorrow.
    const now = at(SG, 2026, 8, 5, 9, 10)
    expect(defaultDialogRange(now, SG, BAND)).toEqual({ dateStr: '2026-08-05', startRow: 5, endRow: 7 })
    expect(defaultDialogRange(now, NY, BAND)).toEqual({ dateStr: '2026-08-04', startRow: 29, endRow: 31 })
  })
  it('rounds a time carrying seconds up to the next half hour', () => {
    const now = new Date(+at(SG, 2026, 8, 5, 9) + 30_000)
    expect(defaultDialogRange(now, SG, BAND)).toEqual({ dateStr: '2026-08-05', startRow: 5, endRow: 7 })
  })
})
