'use client'
import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { createTrainingRequestAction } from '@/app/(app)/certifications/actions'

type Props = {
  equipmentId: string
  equipmentName: string
  // The blocked booking dialog mounts a compact variant inside its banner; the
  // equipment-page aside and catalogue cards use the default outlined style.
  tone?: 'default' | 'accent'
}

// v0.32 Task 7: the single "Request training" affordance, reused by the equipment
// page's policy aside, the booking dialog's certification_required banner, and the
// catalogue's "Needs certification" cards. Server-side callers gate it to
// member/admin and hide it from the already-certified; the action re-checks.
export default function RequestTrainingButton({ equipmentId, equipmentName, tone = 'default' }: Props) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [pending, start] = useTransition()

  function submit() {
    start(async () => {
      const r = await createTrainingRequestAction(equipmentId, note)
      // Result is toasted either way (the brief's contract): success closes the
      // modal; a failure keeps it open so the note survives adjustment. Service
      // messages are written for the requester verbatim (duplicate request,
      // guests, already certified) — surface, don't rephrase.
      toast(r.ok ? 'Training request sent.' : r.message ?? 'Could not send — check your connection and try again.')
      if (r.ok) {
        setOpen(false)
        // The note is per-ask draft state: a fresh modal (this instrument or any
        // other) starts clean rather than re-offering the sent text.
        setNote('')
      }
    })
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={
          tone === 'accent'
            ? 'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
            : 'w-full rounded-md border border-border px-3 py-1.5 text-sm text-default transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
        }>
        Request training
      </button>
      {open && (
        <Modal title={`Request training — ${equipmentName}`} onClose={() => { if (!pending) setOpen(false) }}>
          <p className="mt-2 text-sm text-muted">The instrument&apos;s managers are notified and can grant your certification (the admins, if it has no managers).</p>
          <label className="mt-3 block text-sm text-default">Note <span className="text-subtle">(optional)</span>
            <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. ready for hBN growth runs from next week"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={pending} onClick={() => setOpen(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Cancel</button>
            <button type="button" disabled={pending} onClick={submit}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
              {pending ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
