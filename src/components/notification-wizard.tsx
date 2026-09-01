'use client'
import { useEffect, useState } from 'react'
import { BellPlus, Check, Send } from 'lucide-react'
import { Modal } from './ui/modal'
import { useNotificationStatus } from './hooks/use-notification-state'
import { subscribeToPush } from '@/lib/push-subscribe'

// "Get notified" setup surface (2026-09 notifications design): walks a
// member to fully-enabled phone push — install / permission / subscribe —
// and closes the loop with a REAL test ping. State-aware: insecure deploys
// warn, iOS-in-Safari routes to Add-to-Home-Screen first, denied permission
// guides to OS settings. Renders through the shared Modal (focus trap,
// restore, Escape, overlay-dismiss) instead of a hand-rolled overlay.
export function NotificationWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status, refresh } = useNotificationStatus()
  const [busy, setBusy] = useState(false)
  const [testSent, setTestSent] = useState(false)
  const [error, setError] = useState(false)

  // Deliberate reset on the OPEN TRANSITION only (deps [open], never onClose):
  // Bell re-renders on every 30 s poll / SSE event, and an effect keyed on
  // onClose's identity would re-run mid-visit and wipe the "Sent!" note.
  // Each wizard visit starts clean (test not sent, no stale error).
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTestSent(false)
    setError(false)
  }, [open])

  if (!open) return null

  async function enable() {
    setBusy(true)
    setError(false)
    try {
      const perm = 'Notification' in window ? await Notification.requestPermission() : 'denied'
      // Failure either way: permission not granted, or the subscribe/POST leg
      // failing (subscribeToPush returns false) — surface it under the button.
      setError(perm === 'granted' ? !(await subscribeToPush()) : true)
    } finally {
      setBusy(false)
      refresh()
    }
  }

  async function sendTest() {
    setBusy(true)
    try {
      const r = await fetch('/api/push/test', { method: 'POST' })
      if (r.ok) setTestSent(true)
    } catch { /* transient */ } finally { setBusy(false) }
  }

  return (
    <Modal title="Get notified" onClose={onClose}>
      <div aria-live="polite">
        {status === null && <p className="mt-3 text-sm text-subtle">Checking this device…</p>}

        {status === 'shell' && (
          <p className="mt-3 text-sm text-muted">You are in the desktop app — notifications and sounds are built in. Open LabHub on your phone to enable mobile push.</p>
        )}
        {status === 'insecure' && (
          <p className="mt-3 text-sm text-muted">Push notifications need HTTPS. Ask your admin to enable the HTTPS tunnel, then open this bell again.</p>
        )}
        {status === 'unsupported' && (
          <p className="mt-3 text-sm text-muted">This browser cannot receive web push. On iPhone/iPad use Safari; on Android use Chrome.</p>
        )}
        {status === 'ios-install' && (
          <div className="mt-3 text-sm text-muted">
            <p>iPhone/iPad push works from the home-screen app:</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4">
              <li>Tap <span className="text-default">Share</span> in Safari&apos;s toolbar.</li>
              <li>Tap <span className="text-default">Add to Home Screen</span>.</li>
              <li>Open LabHub from the home screen, then finish here.</li>
            </ol>
          </div>
        )}
        {status === 'denied' && (
          <p className="mt-3 text-sm text-muted">Notification permission is blocked for this site. Re-enable it in your browser or OS site settings, then open this bell again.</p>
        )}
        {(status === 'ready' || status === 'denied') && (
          <>
            <button type="button" onClick={() => void enable()} disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-on hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
              <BellPlus size={16} aria-hidden /> Enable notifications
            </button>
            {error && <p role="alert" className="mt-2 text-xs text-[var(--text-danger)]">Couldn&apos;t enable notifications — check the permission prompt and try again.</p>}
          </>
        )}
        {status === 'done' && (
          <div className="mt-3">
            <p className="flex items-center gap-2 text-sm text-muted">
              <Check size={16} className="text-accent" aria-hidden /> Push is enabled on this device.
            </p>
            <button type="button" onClick={() => void sendTest()} disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
              <Send size={16} aria-hidden /> Send test notification
            </button>
            {testSent && <p className="mt-2 text-xs text-subtle">Sent! Check your devices — it should arrive with a sound within a few seconds.</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}
