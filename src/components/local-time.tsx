'use client'
import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 30_000)
  return () => clearInterval(id)
}
const getSnapshot = () => Math.floor(Date.now() / 30_000)
const getServerSnapshot = () => 0

// The member's current local time, computed client-side in their timezone.
// Renders nothing on the server / first hydration pass (snapshot 0) to avoid a
// mismatch, then paints e.g. "3:42 PM local".
export function LocalTime({ timezone }: { timezone: string | null }) {
  const tick = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  if (tick === 0 || !timezone) return null
  let label: string
  try {
    label = new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date())
  } catch {
    return null
  }
  return <span className="text-xs text-subtle tabular-nums">{label} local</span>
}
