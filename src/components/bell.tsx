'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

type Item = { id: string; type: string; payload: Record<string, string>; readAt: string | null; createdAt: string }

const LABEL: Record<string, string> = {
  booking_pending: 'Booking needs approval',
  booking_decided: 'Booking decision',
  booking_cancelled_maintenance: 'Booking cancelled (maintenance)',
  booking_reminder: 'Upcoming booking',
  booking_expired: 'Booking request expired',
  booking_cancelled: 'Booking cancelled',
}

export default function Bell() {
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications')
      if (!r.ok) return
      const d = await r.json()
      setUnread(d.unread); setItems(d.items)
    } catch { /* transient network error; next poll retries */ }
  }, [])

  useEffect(() => {
    // Fetch-on-mount: load() is async and only setStates after an awaited network
    // round-trip, so it can't cause the synchronous cascading render this rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const t = setInterval(load, 30_000) // spec: 30 s polling
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      const ids = items.filter((i) => !i.readAt).map((i) => i.id)
      await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      setUnread(0)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} aria-label="Notifications" className="relative rounded-full p-2 hover:bg-gray-100">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
          {items.length === 0 && <p className="p-3 text-sm text-gray-500">No notifications yet.</p>}
          {items.map((i) => (
            <div key={i.id} className={`rounded-lg p-3 text-sm ${i.readAt ? 'text-gray-500' : 'font-medium'}`}>
              <p>{LABEL[i.type] ?? i.type}</p>
              {typeof i.payload?.message === 'string' && <p className="mt-0.5 font-normal text-gray-600">{i.payload.message}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
