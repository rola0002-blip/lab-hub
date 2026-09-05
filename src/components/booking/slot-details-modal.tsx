'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/modal'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { formatRange } from '@/lib/time'
import { BOOKING_VARIANT } from '@/features/booking/chip'
import { cancelMyBookingAction, logOnAction, logOffAction, saveSessionNoteAction } from '@/app/(app)/bookings/actions'
import type { CalSlot } from '@/components/schedule-view'

type Props = {
  slot: CalSlot
  timezone: string
  // Decided by the caller (kind + own/canManage + future + live status) — this
  // component only renders the affordance ScheduleView already ruled on. The
  // service re-checks all of it, so this is presentation, not authorization.
  canCancel: boolean
  // W12-C session affordance (own-or-manage + CONFIRMED + not yet ended). Loose
  // the same way: the service owns the log-on/log-off windows.
  canSession?: boolean
  onClose: () => void
}

// Read-only details for one schedule block, plus the single-occurrence cancel.
// The `CalSlot` type import is type-only, so the cycle with schedule-view.tsx is
// erased at compile time and never reaches the bundle graph.
//
// Series cancellation stays on /bookings: a CalSlot is one occurrence and carries
// no recurrence identity, so `scope` here is always 'one'.
export default function SlotDetailsModal({ slot, timezone, canCancel, canSession, onClose }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(slot.sessionNote ?? '')

  async function cancel() {
    if (!window.confirm('Cancel this booking?')) return
    setBusy(true)
    try {
      const r = await cancelMyBookingAction(slot.id, 'one')
      // Every arm that keeps this modal mounted clears `busy` itself; the success
      // arm deliberately does not, so nothing sets state after the unmount.
      if (!r.ok) { toast(r.message ?? 'This booking could not be cancelled.'); setBusy(false); return }
      // The action revalidates /bookings only — the schedule behind this modal is
      // a different route, so it needs its own refresh.
      router.refresh()
      onClose()
    } catch {
      toast("We couldn't reach the server — the booking wasn't cancelled.")
      setBusy(false)
    }
  }

  // The session pair shares cancel()'s busy contract: success closes the modal
  // without clearing `busy`; every arm that stays mounted clears it.
  async function logOn() {
    setBusy(true)
    try {
      const r = await logOnAction(slot.id)
      if (!r.ok) { toast(r.message ?? 'This session could not be logged on.'); setBusy(false); return }
      router.refresh()
      onClose()
    } catch {
      toast("We couldn't reach the server — the session wasn't logged on.")
      setBusy(false)
    }
  }

  async function logOff() {
    setBusy(true)
    try {
      const r = await logOffAction(slot.id, note)
      if (!r.ok) { toast(r.message ?? 'This session could not be logged off.'); setBusy(false); return }
      router.refresh()
      onClose()
    } catch {
      toast("We couldn't reach the server — the session wasn't logged off.")
      setBusy(false)
    }
  }

  async function saveNote() {
    setBusy(true)
    try {
      const r = await saveSessionNoteAction(slot.id, note)
      if (!r.ok) { toast(r.message ?? 'The note was not saved.'); setBusy(false); return }
      toast('Saved.')
      setBusy(false)
    } catch {
      toast("We couldn't reach the server — the note wasn't saved.")
      setBusy(false)
    }
  }

  return (
    <Modal title={slot.kind === 'maintenance' ? 'Maintenance' : 'Booking details'} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm font-medium text-default">{slot.label}</p>
        <p className="text-sm text-muted">{formatRange(new Date(slot.startsAt), new Date(slot.endsAt), timezone)}</p>
        {/* `CalSlot.status` is a bare string and maintenance carries none, so the
            guard and the cast are both load-bearing (bookings-client.tsx:33's
            idiom). The chip renders the WORD, so status is never colour alone. */}
        {slot.status && (
          <p><Badge variant={BOOKING_VARIANT[slot.status as keyof typeof BOOKING_VARIANT]}>{slot.status.toLowerCase()}</Badge></p>
        )}
        {canSession && !slot.sessionStartedAt && (
          <div className="flex justify-end pt-1">
            {/* The Cancel booking structure (min-h-11 = the 44px touch bar, §4.3)
                recoloured accent: log-on is the affirmative action, not danger. */}
            <button type="button" disabled={busy} onClick={logOn}
              className="min-h-11 rounded-md border border-[var(--accent)]/40 px-4 text-sm font-medium text-[var(--text-accent)] transition-colors hover:bg-hover active:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
              Log on
            </button>
          </div>
        )}
        {canSession && slot.sessionStartedAt && (
          <div className="space-y-2">
            {/* maxLength mirrors the zod trim().max(1000) guard on both note
                actions; the text-base input idiom (§4.3 zoom-on-focus). */}
            <label className="block text-sm text-default">Session note
              <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={saveNote}
                className="min-h-11 rounded-md border border-border px-4 text-sm text-default transition-colors hover:bg-hover active:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Save note</button>
              <button type="button" disabled={busy} onClick={logOff}
                className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Log off</button>
            </div>
          </div>
        )}
        {slot.sessionStartedAt && slot.sessionEndedAt && (
          <p className="text-sm text-muted">
            Session: {formatRange(new Date(slot.sessionStartedAt), new Date(slot.sessionEndedAt), timezone)}
            {slot.sessionNote && <> · Notes: {slot.sessionNote}</>}
          </p>
        )}
        {canCancel && (
          <div className="flex justify-end pt-1">
            {/* Danger reads as ink on the modal's own surface rather than a danger
                FILL: --text-danger is the theme-flipped AA-on-canvas token, while
                --color-danger is a fill that would not carry white text at 4.5:1.
                min-h-11 is the 44px touch bar (§4.3). */}
            <button type="button" disabled={busy} onClick={cancel}
              className="min-h-11 rounded-md border border-[var(--text-danger)]/40 px-4 text-sm font-medium text-[var(--text-danger)] transition-colors hover:bg-hover active:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
              {busy ? 'Cancelling…' : 'Cancel booking'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
