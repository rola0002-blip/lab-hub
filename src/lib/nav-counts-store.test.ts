import { describe, it, expect, beforeEach } from 'vitest'
import { navCountsSnapshot, subscribeNavCounts, refreshNavCounts, clearNavCounts, _resetNavCountsForTests } from './nav-counts-store'

const ok = (body: unknown) => (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch

describe('nav counts store', () => {
  beforeEach(_resetNavCountsForTests)

  it('starts unloaded (null) so the Sidebar paints the SSR seed', () => {
    expect(navCountsSnapshot()).toBeNull()
  })
  it('a refresh stores the counts and notifies subscribers; the snapshot identity is stable between refreshes', async () => {
    let calls = 0
    subscribeNavCounts(() => { calls++ })
    await refreshNavCounts(ok({ approvals: 2, trainingRequests: 1 }))
    expect(navCountsSnapshot()).toEqual({ approvals: 2, trainingRequests: 1 })
    expect(calls).toBe(1)
    expect(navCountsSnapshot()).toBe(navCountsSnapshot())
  })
  it('a failed, thrown or malformed response keeps the previous value', async () => {
    await refreshNavCounts(ok({ approvals: 1, trainingRequests: 0 }))
    await refreshNavCounts((async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch)
    await refreshNavCounts((async () => { throw new Error('offline') }) as unknown as typeof fetch)
    await refreshNavCounts(ok({ approvals: -1, trainingRequests: 'x' }))
    expect(navCountsSnapshot()).toEqual({ approvals: 1, trainingRequests: 0 })
  })
  it('last-ISSUED wins: a slow earlier response never overwrites a fresher one', async () => {
    let release!: () => void
    const slow = (async () => { await new Promise<void>((r) => { release = r }); return { ok: true, json: async () => ({ approvals: 9, trainingRequests: 9 }) } }) as unknown as typeof fetch
    const p1 = refreshNavCounts(slow)
    await refreshNavCounts(ok({ approvals: 0, trainingRequests: 0 }))
    release(); await p1
    expect(navCountsSnapshot()).toEqual({ approvals: 0, trainingRequests: 0 })
  })
  it('clear forgets the counts, notifies, and discards a response issued before it', async () => {
    await refreshNavCounts(ok({ approvals: 3, trainingRequests: 1 }))
    let calls = 0
    subscribeNavCounts(() => { calls++ })
    let release!: () => void
    const slow = (async () => { await new Promise<void>((r) => { release = r }); return { ok: true, json: async () => ({ approvals: 5, trainingRequests: 5 }) } }) as unknown as typeof fetch
    const p = refreshNavCounts(slow)
    clearNavCounts()
    expect(navCountsSnapshot()).toBeNull()
    expect(calls).toBe(1)
    release(); await p
    expect(navCountsSnapshot()).toBeNull()
    clearNavCounts() // already clear: no further notification
    expect(calls).toBe(1)
  })
  it('unsubscribe stops notifications', async () => {
    let calls = 0
    const off = subscribeNavCounts(() => { calls++ })
    off()
    await refreshNavCounts(ok({ approvals: 1, trainingRequests: 1 }))
    expect(calls).toBe(0)
  })
})
