'use client'
import { useEffect, useRef, useState } from 'react'
import { BellPlus, Check, Send, X } from 'lucide-react'
import { useNotificationStatus } from './hooks/use-notification-state'
import { subscribeToPush } from './hooks/use-push-optin'

// "Get notified" setup surface (2026-09 notifications design): walks a
// member to fully-enabled phone push — install / permission / subscribe —
// and closes the loop with a REAL test ping. State-aware: insecure deploys
// warn, iOS-in-Safari routes to Add-to-Home-Screen first, denied permission
// guides to OS settings.
export function NotificationWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status, refresh } = useNotificationStatus()
  const [busy, setBusy] = useState(false)
  const [testSent, setTestSent] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Deliberate reset-on-open: each wizard visit starts with a clean
    // "test not sent" state (one setState, not a cascading render chain).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTestSent(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function enable() {
    setBusy(true)
    try {
      const perm = 'Notification' in window ? await Notification.requestPermission() : 'denied'
      if (perm === 'granted') await subscribeToPush()
    } finally {
      setBusy(false)
      refresh()
    }
  }

  async function sendTest() {
    setBusy(true)
    try {
      await fetch('/api/push/test', { method: 'POST' })
      setTestSent(true)
    } catch { /* transient */ } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="notify-wizard-title"
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-menu">
        <div className="flex items-center justify-between">
          <h2 id="notify-wizard-title" className="text-base font-semibold text-default">Get notified</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="rounded p-1 text-subtle hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
            <X size={16} aria-hidden />
          </button>
        </div>

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
          <button type="button" onClick={() => void enable()} disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-on hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
            <BellPlus size={16} aria-hidden /> Enable notifications
          </button>
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
    </div>
  )
}
