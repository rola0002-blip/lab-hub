import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEventRegistry } from '@/components/event-registry'
import { sharedRegistry } from '@/components/use-events'

function fakeEs(readyState = 0) {
  const es = { onopen: null as null | (() => void), onerror: null as null | (() => void),
    onmessage: null as null | ((ev: { data: string }) => void), readyState }
  return es
}

describe('event registry', () => {
  it('delivers one parsed event to every subscriber', () => {
    const es = fakeEs()
    const reg = createEventRegistry(() => es as unknown as EventSource)
    const a = vi.fn(); const b = vi.fn()
    reg.subscribe(a); reg.subscribe(b)
    es.onmessage!({ data: JSON.stringify({ t: 'msg', cid: 'c1', mid: 'm1' }) })
    expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledOnce()
  })
  it('synthesizes reconnect to all subscribers once after a drop', () => {
    const es = fakeEs()
    const reg = createEventRegistry(() => es as unknown as EventSource)
    const a = vi.fn(); reg.subscribe(a)
    es.onerror!()
    es.onopen!()
    expect(a).toHaveBeenCalledWith({ t: 'reconnect' })
    es.onopen!() // steady-state reopen: no duplicate sentinel
    expect(a).toHaveBeenCalledTimes(1)
  })
  it('unsubscribe stops delivery', () => {
    const es = fakeEs()
    const reg = createEventRegistry(() => es as unknown as EventSource)
    const a = vi.fn(); const off = reg.subscribe(a); off()
    es.onmessage!({ data: JSON.stringify({ t: 'msg', cid: 'c', mid: 'm' }) })
    expect(a).not.toHaveBeenCalled()
  })
  it('a throwing subscriber does not starve later subscribers', () => {
    const es = fakeEs()
    const reg = createEventRegistry(() => es as unknown as EventSource)
    const boom = vi.fn(() => { throw new Error('handler bug') })
    const ok = vi.fn()
    reg.subscribe(boom); reg.subscribe(ok)
    es.onmessage!({ data: JSON.stringify({ t: 'msg', cid: 'c', mid: 'm' }) })
    expect(boom).toHaveBeenCalledOnce()
    expect(ok).toHaveBeenCalledWith({ t: 'msg', cid: 'c', mid: 'm' })
  })
  it('a throwing subscriber does not starve the reconnect sentinel', () => {
    const es = fakeEs()
    const reg = createEventRegistry(() => es as unknown as EventSource)
    const boom = vi.fn(() => { throw new Error('handler bug') })
    const ok = vi.fn()
    reg.subscribe(boom); reg.subscribe(ok)
    es.onerror!()
    es.onopen!()
    expect(boom).toHaveBeenCalledWith({ t: 'reconnect' })
    expect(ok).toHaveBeenCalledWith({ t: 'reconnect' })
  })
})

describe('shared SSE registry revival', () => {
  const g = globalThis as unknown as { __labhubEventRegistry?: ReturnType<typeof createEventRegistry> }
  let created: ReturnType<typeof fakeEs>[]

  beforeEach(() => {
    delete g.__labhubEventRegistry
    created = []
    // A constructible stub carrying the readyState constants sharedRegistry reads.
    const Stub = Object.assign(
      function () { const es = fakeEs(); created.push(es); return es },
      { CONNECTING: 0, OPEN: 1, CLOSED: 2 },
    )
    vi.stubGlobal('EventSource', Stub)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete g.__labhubEventRegistry
  })

  it('discards a CLOSED cached registry and serves subscribers from a fresh source', () => {
    // Sign-out kills /api/events with a 401 → the SSE spec fails the source
    // permanently (CLOSED, no retry). The cached singleton must not be reused.
    const dead = fakeEs(2)
    g.__labhubEventRegistry = createEventRegistry(() => dead as unknown as EventSource)
    const reg = sharedRegistry()
    expect(reg.es).not.toBe(dead)
    expect(created).toHaveLength(1) // a fresh EventSource was constructed
    const got = vi.fn()
    reg.subscribe(got)
    created[0].onmessage!({ data: JSON.stringify({ t: 'msg', cid: 'c', mid: 'm' }) })
    expect(got).toHaveBeenCalledWith({ t: 'msg', cid: 'c', mid: 'm' })
  })

  it('reuses a cached registry whose stream is still live (OPEN or CONNECTING)', () => {
    for (const readyState of [0, 1]) {
      delete g.__labhubEventRegistry
      created.length = 0
      const cached = createEventRegistry(() => fakeEs(readyState) as unknown as EventSource)
      g.__labhubEventRegistry = cached
      expect(sharedRegistry()).toBe(cached)
      expect(created).toHaveLength(0) // no new EventSource — one stream per tab holds
    }
  })
})
