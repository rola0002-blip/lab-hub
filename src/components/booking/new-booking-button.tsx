'use client'
import { useState } from 'react'
import BookingDialog from '@/components/booking-dialog'
import { defaultDialogRange, rowsToRange } from '@/features/booking/grid'

type Props = {
  equipmentId: string; timezone: string; allowRecurring: boolean
  equipmentName: string; equipmentLocation: string; retired: boolean
}

// The keyboard- and pointer-reachable way into the booking dialog at every width:
// no drag, no tap-and-drag, just a button that opens the (now fully editable)
// dialog on the next free half hour. It owns its OWN dialog mount, independent of
// the schedule's drag/draft mounts — only one is ever open in practice.
export default function NewBookingButton({ equipmentId, timezone, allowRecurring, equipmentName, equipmentLocation, retired }: Props) {
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null)

  // Retired instruments take no new bookings (the schedule says so in words), so
  // the affordance is absent rather than present-and-refused.
  if (retired) return null

  function open() {
    // Resolved at click time, not at render: a page left open past the hour must
    // still offer the next free slot, not the one it rendered with.
    const { dateStr, startRow, endRow } = defaultDialogRange(new Date(), timezone)
    setRange(rowsToRange(dateStr, startRow, endRow, timezone))
  }

  return (
    <>
      <button type="button" onClick={open}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover">
        New booking
      </button>
      {range && (
        <BookingDialog equipmentId={equipmentId} timezone={timezone} allowRecurring={allowRecurring}
          equipmentName={equipmentName} equipmentLocation={equipmentLocation}
          initialStart={range.start} initialEnd={range.end} onClose={() => setRange(null)} />
      )}
    </>
  )
}
