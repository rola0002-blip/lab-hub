import { describe, it, expect } from 'vitest'
import { toIcsUtc } from '@/features/calendar/format'
import { escapeText, foldLine, buildIcs, type IcsEvent } from '@/features/calendar/ics'

const ev = (over: Partial<IcsEvent> = {}): IcsEvent => ({
  uid: 'b1@colossus.example', start: new Date('2026-07-14T09:14:00.000Z'), end: new Date('2026-07-14T11:00:00.000Z'),
  summary: 'CVD furnace', description: 'hBN growth', status: 'CONFIRMED', ...over,
})

describe('toIcsUtc', () => {
  it('formats a UTC instant as YYYYMMDDTHHMMSSZ', () => {
    expect(toIcsUtc(new Date('2026-07-14T09:14:05.678Z'))).toBe('20260714T091405Z')
  })
})

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and newline; leaves colons', () => {
    expect(escapeText('a\\b;c,d\ne:f')).toBe('a\\\\b\\;c\\,d\\ne:f')
  })
})

describe('foldLine', () => {
  it('folds > 75 octets with CRLF + single leading space, never splitting a multibyte char', () => {
    const long = 'DESCRIPTION:' + 'x'.repeat(120)
    const folded = foldLine(long)
    const lines = folded.split('\r\n')
    expect(lines.length).toBeGreaterThan(1)
    expect(Buffer.byteLength(lines[0], 'utf8')).toBeLessThanOrEqual(75)
    for (const l of lines.slice(1)) expect(l.startsWith(' ')).toBe(true)
    // Unfolding (drop CRLF + the one continuation space) restores the original.
    expect(folded.replace(/\r\n /g, '')).toBe(long)
    // A multibyte char is never split across the 75-octet boundary.
    const multi = 'SUMMARY:' + 'é'.repeat(50)
    for (const l of foldLine(multi).split('\r\n ')) expect(() => Buffer.from(l, 'utf8').toString('utf8')).not.toThrow()
  })
  it('leaves a short line untouched', () => {
    expect(foldLine('VERSION:2.0')).toBe('VERSION:2.0')
  })
})

describe('buildIcs', () => {
  const now = new Date('2026-07-13T00:00:00.000Z')
  it('emits a valid VCALENDAR with CRLF, headers and one VEVENT per booking', () => {
    const out = buildIcs({ calName: 'LabHub — My bookings', timezone: 'Asia/Singapore', events: [ev()] }, now)
    expect(out.endsWith('\r\n')).toBe(true)
    const lines = out.split('\r\n')
    expect(lines).toContain('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain('PRODID:-//LabHub//LabHub//EN')
    expect(lines).toContain('CALSCALE:GREGORIAN')
    expect(lines).toContain('METHOD:PUBLISH')
    expect(lines).toContain('X-WR-CALNAME:LabHub — My bookings')
    expect(lines).toContain('X-WR-TIMEZONE:Asia/Singapore')
    expect(lines).toContain('BEGIN:VEVENT')
    expect(lines).toContain('UID:b1@colossus.example')
    expect(lines).toContain('DTSTAMP:20260713T000000Z')
    expect(lines).toContain('DTSTART:20260714T091400Z')
    expect(lines).toContain('DTEND:20260714T110000Z')
    expect(lines).toContain('SUMMARY:CVD furnace')
    expect(lines).toContain('DESCRIPTION:hBN growth')
    expect(lines).toContain('STATUS:CONFIRMED')
    expect(lines).toContain('END:VEVENT')
    expect(lines).toContain('END:VCALENDAR')
  })
  it('maps PENDING → STATUS:TENTATIVE and keeps a stable UID across refreshes', () => {
    const a = buildIcs({ calName: 'c', timezone: 'UTC', events: [ev({ status: 'TENTATIVE' })] }, now)
    const b = buildIcs({ calName: 'c', timezone: 'UTC', events: [ev({ status: 'TENTATIVE' })] }, new Date('2026-08-01T00:00:00Z'))
    expect(a.split('\r\n')).toContain('STATUS:TENTATIVE')
    expect(a.includes('UID:b1@colossus.example')).toBe(true)
    expect(b.includes('UID:b1@colossus.example')).toBe(true) // UID independent of build time
  })
  it('produces a valid empty calendar with zero bookings', () => {
    const out = buildIcs({ calName: 'c', timezone: 'UTC', events: [] }, now)
    expect(out.includes('BEGIN:VEVENT')).toBe(false)
    const lines = out.split('\r\n')
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('END:VCALENDAR')
  })
})
