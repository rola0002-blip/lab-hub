export type Registry = {
  es: EventSource
  subscribe: (l: (e: unknown) => void) => () => void
}

export function createEventRegistry(make: () => EventSource): Registry {
  const listeners = new Set<(e: unknown) => void>()
  let hadDrop = false
  const es = make()
  es.onopen = () => { if (hadDrop) { hadDrop = false; for (const l of listeners) l({ t: 'reconnect' }) } }
  es.onerror = () => { hadDrop = true }
  es.onmessage = (ev) => { try { const e = JSON.parse(ev.data); for (const l of listeners) l(e) } catch { /* malformed frame */ } }
  return { es, subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l) } } }
}
