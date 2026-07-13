'use client'
import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { googleCalendarLink, outlookCalendarLink } from '@/features/calendar/links'

type Props = { bookingId: string; summary: string; startsAt: string; endsAt: string; purpose: string; location: string }

// Reused on the My-bookings list and the post-booking confirmation. Times arrive as
// ISO strings (UTC) and are rebuilt to Dates for the pure link builders.
export function AddToCalendar({ bookingId, summary, startsAt, endsAt, purpose, location }: Props) {
  const [open, setOpen] = useState(false)
  const start = new Date(startsAt), end = new Date(endsAt)
  const google = googleCalendarLink({ summary, start, end, details: purpose, location })
  const outlook = outlookCalendarLink({ summary, start, end, details: purpose, location })
  const item = 'block w-full px-3 py-1.5 text-left text-sm text-default hover:bg-hover focus-visible:bg-hover focus-visible:outline-none'
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm text-default transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
        <CalendarPlus size={14} aria-hidden /> Add to calendar
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-border bg-surface shadow-md">
          <a role="menuitem" href={`/api/bookings/${bookingId}/ics`} className={item}>Download .ics</a>
          <a role="menuitem" href={google} target="_blank" rel="noreferrer" className={item}>Google Calendar</a>
          <a role="menuitem" href={outlook} target="_blank" rel="noreferrer" className={item}>Outlook</a>
        </div>
      )}
    </div>
  )
}
