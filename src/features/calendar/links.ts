import { toIcsUtc } from './format'

// Quick-add template links (no OAuth). URLSearchParams encodes every value, so the
// summary/details/location are always safe. Client-safe (only imports the leaf
// format module — no Buffer).
export type CalendarLinkInput = { summary: string; start: Date; end: Date; details: string; location: string }

export function googleCalendarLink(i: CalendarLinkInput): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: i.summary,
    dates: `${toIcsUtc(i.start)}/${toIcsUtc(i.end)}`,
    details: i.details,
    location: i.location,
  })
  return `https://calendar.google.com/calendar/render?${p.toString()}`
}

export function outlookCalendarLink(i: CalendarLinkInput): string {
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: i.summary,
    startdt: i.start.toISOString(),
    enddt: i.end.toISOString(),
    body: i.details,
    location: i.location,
  })
  return `https://outlook.office.com/calendar/0/deeplink/compose?${p.toString()}`
}
