'use client'
import { useEffect, useState } from 'react'
import { popupPref, setPopupPref } from '@/lib/popup-pref'

// Profile Appearance row (Task 9): the Message popups switch mirrors
// SoundsToggle's visual language and per-device posture, but its value only
// takes effect once the browser granted the plain Notification permission —
// so until then the switch disables and an Enable button (or, when blocked,
// a site-settings hint) sits beside it. localStorage and Notification
// permission are read in a mount effect: SSR renders the disabled fallback
// (no hydration mismatch) and the effect syncs the real device state.
export function PopupToggle() {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported' | null>(null)
  const [on, setOn] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPerm(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
    setOn(popupPref())
  }, [])

  async function enable() {
    if (typeof Notification === 'undefined') return
    setBusy(true)
    try {
      setPerm(await Notification.requestPermission())
    } finally { setBusy(false) }
  }

  const granted = perm === 'granted'
  const active = granted && on

  return (
    <span className="flex items-center gap-2">
      {perm === 'denied' && (
        <span className="text-xs text-subtle">Blocked in browser site settings</span>
      )}
      {perm !== null && perm !== 'denied' && perm !== 'unsupported' && !granted && (
        <button type="button" onClick={() => void enable()} disabled={busy}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
          Enable
        </button>
      )}
      <button type="button" role="switch" aria-checked={active} aria-label="Message popups" disabled={!granted}
        onClick={() => { setOn(!on); setPopupPref(!on) }}
        className={`relative h-6 w-11 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:cursor-not-allowed disabled:opacity-50 ${active ? 'border-transparent bg-accent' : 'border-border bg-active'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface transition-all ${active ? 'left-[1.375rem]' : 'left-0.5'}`} />
      </button>
    </span>
  )
}
