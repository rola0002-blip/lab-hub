'use client'
import { useEffect, useRef, useState } from 'react'
import type { LabEvent } from '@/lib/events'
import { createEventRegistry } from './event-registry'

export type ClientEvent = LabEvent | { t: 'reconnect' }

// One EventSource per browser tab (globalThis-cached for HMR, the db.ts precedent).
// The old per-hook EventSource multiplied streams (chat-store + bell + issue views
// = 3+ concurrent /api/events) and could exhaust the browser's 6-connections-per-
// origin HTTP/1.1 budget on self-hosted deployments.
const g = globalThis as unknown as { __labhubEventRegistry?: ReturnType<typeof createEventRegistry> }
function sharedRegistry() {
  if (!g.__labhubEventRegistry) g.__labhubEventRegistry = createEventRegistry(() => new EventSource('/api/events'))
  return g.__labhubEventRegistry
}

export function useEvents(onEvent: (e: ClientEvent) => void): { connected: boolean } {
  const [connected, setConnected] = useState(false)
  const cb = useRef(onEvent)
  // eslint-disable-next-line react-hooks/refs
  cb.current = onEvent
  useEffect(() => {
    const reg = sharedRegistry()
    const off = reg.subscribe((e) => cb.current(e as ClientEvent))
    const onOpen = () => setConnected(true)
    const onErr = () => setConnected(false)
    reg.es.addEventListener('open', onOpen)
    reg.es.addEventListener('error', onErr)
    // The shared stream may already be OPEN when this consumer mounts; sync once
    // (subscribing to an external system — the repo's sanctioned disable pattern).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConnected(reg.es.readyState === EventSource.OPEN)
    return () => { off(); reg.es.removeEventListener('open', onOpen); reg.es.removeEventListener('error', onErr) }
  }, [])
  return { connected }
}
