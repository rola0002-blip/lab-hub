'use client'
import { useEffect, useRef, useState } from 'react'
import type { LabEvent } from '@/lib/events'

export type ClientEvent = LabEvent | { t: 'reconnect' }

export function useEvents(onEvent: (e: ClientEvent) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false)
  const cb = useRef(onEvent)
  // "Latest ref" pattern: keep cb pointing at the newest callback so the stable
  // effect below always invokes current handler state. Safe here because cb.current
  // is only READ inside async EventSource handlers, never during render.
  // eslint-disable-next-line react-hooks/refs
  cb.current = onEvent

  useEffect(() => {
    const es = new EventSource('/api/events')
    let hadDrop = false
    es.onopen = () => {
      setConnected(true)
      if (hadDrop) cb.current({ t: 'reconnect' })
    }
    es.onerror = () => { setConnected(false); hadDrop = true } // EventSource retries automatically
    es.onmessage = (ev) => {
      try { cb.current(JSON.parse(ev.data) as LabEvent) } catch { /* ignore malformed frame */ }
    }
    return () => es.close()
  }, [])

  return { connected }
}
