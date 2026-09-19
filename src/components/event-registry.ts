export type Registry = {
  es: EventSource
  subscribe: (l: (e: unknown) => void) => () => void
}

export function createEventRegistry(make: () => EventSource): Registry {
  const listeners = new Set<(e: unknown) => void>()
  let hadDrop = false
  const es = make()
  // Each dispatch is isolated: one consumer's throwing handler must not starve
  // later subscribers (or the reconnect refetch they depend on).
  const dispatch = (e: unknown) => { for (const l of listeners) { try { l(e) } catch { /* one consumer's handler must not starve the others */ } } }
  es.onopen = () => { if (hadDrop) { hadDrop = false; dispatch({ t: 'reconnect' }) } }
  es.onerror = () => { hadDrop = true }
  es.onmessage = (ev) => { try { dispatch(JSON.parse(ev.data)) } catch { /* malformed frame */ } }
  return { es, subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l) } } }
}
