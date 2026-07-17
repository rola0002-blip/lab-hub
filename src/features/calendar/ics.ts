import { toIcsUtc } from './format'

// Pure RFC 5545 VCALENDAR serializer. No DB, no I/O — fully unit-testable. UTC
// instants only (no VTIMEZONE component); X-WR-TIMEZONE is a display hint. Server-
// side use only (foldLine measures UTF-8 octets via Buffer).
export type IcsStatus = 'CONFIRMED' | 'TENTATIVE'
export type IcsEvent = {
  uid: string        // stable across refreshes so clients update in place
  start: Date
  end: Date
  stamp?: Date       // DTSTAMP; defaults to the build time
  summary: string
  description: string
  status: IcsStatus
}
export type IcsCalendar = {
  calName: string    // X-WR-CALNAME
  timezone: string   // X-WR-TIMEZONE (display hint)
  prodId?: string    // default '-//LabHub//LabHub//EN'
  events: IcsEvent[]
}

// Escape a TEXT value per RFC 5545 §3.3.11: backslash FIRST (so we never double-
// escape the escapes we add), then semicolon, comma, newline. Colons are NOT
// escaped in property values.
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n')
}

// Fold one content line to <= 75 OCTETS per RFC 5545 §3.1: continuation lines begin
// with a single space and are joined with CRLF. Measures UTF-8 bytes (not code
// units) and backs off a boundary that would split a multibyte sequence.
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8')
  if (bytes.length <= 75) return line
  const chunks: string[] = []
  let start = 0
  let limit = 75 // first line 75 octets; continuations 74 (the leading space costs one)
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end-- // don't split a UTF-8 sequence
    chunks.push(bytes.subarray(start, end).toString('utf8'))
    start = end
    limit = 74
  }
  return chunks.join('\r\n ')
}

export function buildIcs(cal: IcsCalendar, now: Date = new Date()): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${cal.prodId ?? '-//LabHub//LabHub//EN'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(cal.calName)}`,
    `X-WR-TIMEZONE:${escapeText(cal.timezone)}`,
  ]
  for (const e of cal.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${toIcsUtc(e.stamp ?? now)}`,
      `DTSTART:${toIcsUtc(e.start)}`,
      `DTEND:${toIcsUtc(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      `STATUS:${e.status}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
