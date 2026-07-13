'use client'
import { CalendarPlus } from 'lucide-react'
import { Menu } from '@/components/ui/menu'
import { googleCalendarLink, outlookCalendarLink } from '@/features/calendar/links'

type Props = { bookingId: string; summary: string; startsAt: string; endsAt: string; purpose: string; location: string }

// Chip-style trigger (the shared Menu's default is a 28px icon button); keep the
// bordered pill look and the ≥2px focus ring the bespoke button had.
const CHIP = 'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm text-default transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

// Reused on the My-bookings list and the post-booking confirmation. Times arrive as
// ISO strings (UTC) and are rebuilt to Dates for the pure link builders. Rendered
// through the shared Menu (F3): its layout pass measures the nearest clipping
// ancestor and flips up / height-caps the popover, so the options are never cut off
// by the bookings list's `overflow-hidden` (the old bespoke absolute popover was).
// It also brings Escape / outside-click / close-on-select and menu semantics, and
// its items inherit the app-wide unlayered :focus-visible outline (M7.2).
export function AddToCalendar({ bookingId, summary, startsAt, endsAt, purpose, location }: Props) {
  const start = new Date(startsAt), end = new Date(endsAt)
  const google = googleCalendarLink({ summary, start, end, details: purpose, location })
  const outlook = outlookCalendarLink({ summary, start, end, details: purpose, location })
  return (
    <Menu
      label="Add to calendar"
      buttonClassName={CHIP}
      button={<><CalendarPlus size={14} aria-hidden /> Add to calendar</>}
      items={[
        // The .ics route responds with Content-Disposition: attachment, so a
        // same-tab navigation downloads the file and stays on the page.
        { label: 'Download .ics', onSelect: () => { window.location.href = `/api/bookings/${bookingId}/ics` } },
        { label: 'Google Calendar', onSelect: () => { window.open(google, '_blank', 'noopener,noreferrer') } },
        { label: 'Outlook', onSelect: () => { window.open(outlook, '_blank', 'noopener,noreferrer') } },
      ]}
    />
  )
}
