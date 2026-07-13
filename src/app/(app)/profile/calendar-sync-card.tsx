'use client'
import { useState } from 'react'
import { CalendarClock, Copy, RefreshCw } from 'lucide-react'
import { toast } from '@/lib/toast-store'
import { regenerateIcsTokenAction } from './calendar-actions'

export function CalendarSyncCard({ initialToken, host }: { initialToken: string; host: string }) {
  const [token, setToken] = useState(initialToken)
  const [busy, setBusy] = useState(false)
  const httpsUrl = `https://${host}/api/calendar/${token}.ics`
  const webcalUrl = `webcal://${host}/api/calendar/${token}.ics`

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard.') }
    catch { toast('Could not copy — select the URL and copy it manually.') }
  }
  async function regenerate() {
    if (!confirm('Regenerate your calendar link? The old link stops working immediately.')) return
    setBusy(true)
    const r = await regenerateIcsTokenAction()
    setBusy(false)
    if (r.ok) { setToken(r.token); toast('New calendar link generated.') }
    else toast('Could not regenerate the link.')
  }

  const field = 'flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2'
  const copyBtn = 'shrink-0 rounded-md border border-border p-1.5 text-default transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-xs">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-default"><CalendarClock size={15} aria-hidden /> Calendar sync</h2>
      <p className="mt-1 text-sm text-muted">Subscribe to a read-only feed of your bookings. The link is private — anyone with it can see your booking times.</p>

      <div className="mt-3 space-y-2">
        <label className="block text-xs font-medium text-subtle">One-click (Apple Calendar / Outlook)</label>
        <div className={field}>
          {/* Spec §4.4: the webcal:// link is the ONE-CLICK path — clicking hands the
              scheme to the OS calendar handler. Keep the copy button beside it as a fallback. */}
          <a href={webcalUrl} aria-label="Subscribe via webcal" className="min-w-0 flex-1 truncate text-sm text-[var(--text-accent)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">{webcalUrl}</a>
          <button type="button" onClick={() => copy(webcalUrl)} className={copyBtn} aria-label="Copy webcal URL"><Copy size={14} aria-hidden /></button>
        </div>
        <label className="block text-xs font-medium text-subtle">HTTPS (Google Calendar)</label>
        <div className={field}>
          <input readOnly value={httpsUrl} aria-label="https subscription URL" className="min-w-0 flex-1 bg-transparent text-sm text-default outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
          <button type="button" onClick={() => copy(httpsUrl)} className={copyBtn} aria-label="Copy https URL"><Copy size={14} aria-hidden /></button>
        </div>
      </div>

      <ul className="mt-3 space-y-1 text-xs text-muted">
        <li><strong className="text-default">Google Calendar:</strong> Other calendars → From URL → paste the HTTPS link.</li>
        <li><strong className="text-default">Apple Calendar:</strong> File → New Calendar Subscription → paste the webcal link.</li>
        <li><strong className="text-default">Outlook / Exchange:</strong> Add calendar → Subscribe from web → paste the HTTPS link.</li>
      </ul>

      <button type="button" onClick={regenerate} disabled={busy}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-default transition-colors hover:bg-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
        <RefreshCw size={14} aria-hidden /> Regenerate link
      </button>
    </section>
  )
}
