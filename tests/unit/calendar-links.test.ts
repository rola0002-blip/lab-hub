import { describe, it, expect } from 'vitest'
import { googleCalendarLink, outlookCalendarLink } from '@/features/calendar/links'

const input = {
  summary: 'CVD furnace, run 3', start: new Date('2026-07-14T09:14:00Z'), end: new Date('2026-07-14T11:00:00Z'),
  details: 'hBN growth; 900°C', location: 'Lab 1',
}

describe('googleCalendarLink', () => {
  it('builds a TEMPLATE render link with compact-UTC dates and encoded params', () => {
    const u = new URL(googleCalendarLink(input))
    expect(u.origin + u.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(u.searchParams.get('action')).toBe('TEMPLATE')
    expect(u.searchParams.get('text')).toBe('CVD furnace, run 3')          // decoded round-trip
    expect(u.searchParams.get('dates')).toBe('20260714T091400Z/20260714T110000Z')
    expect(u.searchParams.get('details')).toBe('hBN growth; 900°C')
    expect(u.searchParams.get('location')).toBe('Lab 1')
  })
})

describe('outlookCalendarLink', () => {
  it('builds a compose deep-link with ISO-8601 start/end and encoded params', () => {
    const u = new URL(outlookCalendarLink(input))
    expect(u.origin + u.pathname).toBe('https://outlook.office.com/calendar/0/deeplink/compose')
    expect(u.searchParams.get('rru')).toBe('addevent')
    expect(u.searchParams.get('subject')).toBe('CVD furnace, run 3')
    expect(u.searchParams.get('startdt')).toBe('2026-07-14T09:14:00.000Z')
    expect(u.searchParams.get('enddt')).toBe('2026-07-14T11:00:00.000Z')
    expect(u.searchParams.get('body')).toBe('hBN growth; 900°C')
    expect(u.searchParams.get('location')).toBe('Lab 1')
  })
})
