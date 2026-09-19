import { describe, it, expect, vi } from 'vitest'
import { createEventRegistry } from '@/components/event-registry'

function fakeEs() {
  const es = { onopen: null as null | (() => void), onerror: null as null | (() => void),
    onmessage: null as null | ((ev: { data: string }) => void), readyState: 0 }
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
})
