'use client'
import { useEffect, useRef, useState } from 'react'
import { Modal } from './modal'

// The shared destructive-confirm surface (v0.32 Task 11): every native
// window.confirm() — and the bespoke per-page delete Modals — collapsed into
// one component over the generic <Modal>, so the focus trap, Escape, backdrop
// click and dialog semantics come along for free. Initial focus lands on the
// DISMISS arm (the safe action): a keyboard user reaching for Enter can no
// longer fire the destructive default.
export function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm, onClose }: {
  open: boolean
  title: string
  body?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Focus must land on the DISMISS arm, but the Modal's own focus trap claims
  // the first focusable (the header's Close X) during the same mount flush —
  // observed parent-before-child effect order means a plain focus() here loses.
  // One rAF defers past the flush, and cancels if the dialog closes first.
  useEffect(() => {
    if (!open) return undefined
    const id = requestAnimationFrame(() => cancelRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])
  if (!open) return null
  return (
    <Modal title={title} onClose={onClose}>
      {body && <p className="text-sm text-muted">{body}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onClose}
          className="min-h-11 rounded-md border border-border px-3 py-1.5 text-sm text-default transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
          {cancelLabel}
        </button>
        {/* Contract: closes after onConfirm settles regardless of outcome —
            no veto; a failed action surfaces via the caller's toast, never by
            the dialog staying open. */}
        {/* disabled while busy: a double-click would re-fire the destructive
            action against state the first click is already mutating. */}
        <button type="button" disabled={busy}
          onClick={async () => { setBusy(true); try { await onConfirm(); onClose() } finally { setBusy(false) } }}
          className={`min-h-11 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50 ${danger ? 'bg-[var(--color-danger)] text-white hover:opacity-90' : 'bg-accent text-accent-on hover:bg-accent-hover'}`}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
