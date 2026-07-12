import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { emitEvent, subscribe, hasLiveConnection, onlineUserIds, _resetForTests, type LabEvent } from '@/lib/events'
import { resetDb } from '../factories'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
function collector() {
  const events: LabEvent[] = []
  return { events, send: (e: LabEvent) => events.push(e) }
}

describe('events bus', () => {
  beforeEach(resetDb)
  afterEach(async () => { await _resetForTests() })

  it('routes conversation events only to members and tracks presence', async () => {
    const a = collector()
    const b = collector()
    const offA = subscribe({ userId: 'ua', conversationIds: new Set(['c1']), reload: async () => new Set(['c1']), send: a.send })
    subscribe({ userId: 'ub', conversationIds: new Set(['c2']), reload: async () => new Set(['c2']), send: b.send })
    await wait(300) // listener connects
    expect(hasLiveConnection('ua')).toBe(true)
    expect(onlineUserIds().sort()).toEqual(['ua', 'ub'])

    await emitEvent({ t: 'msg', cid: 'c1', mid: 'm1' })
    await wait(300)
    expect(a.events).toContainEqual({ t: 'msg', cid: 'c1', mid: 'm1' })
    expect(b.events.find((e) => e.t === 'msg')).toBeUndefined()

    offA()
    expect(hasLiveConnection('ua')).toBe(false)
    // ub saw ua's presence online AND offline
    const pres = b.events.filter((e) => e.t === 'presence' && (e as { uid: string }).uid === 'ua')
    expect(pres).toHaveLength(2)
  })

  it("does not echo typing to its own user, and scopes 'read'/'notif' to the user", async () => {
    const a1 = collector() // two tabs for ua
    const a2 = collector()
    const b = collector()
    subscribe({ userId: 'ua', conversationIds: new Set(['c1']), reload: async () => new Set(['c1']), send: a1.send })
    subscribe({ userId: 'ua', conversationIds: new Set(['c1']), reload: async () => new Set(['c1']), send: a2.send })
    subscribe({ userId: 'ub', conversationIds: new Set(['c1']), reload: async () => new Set(['c1']), send: b.send })
    await wait(300)

    await emitEvent({ t: 'typing', cid: 'c1', uid: 'ua', name: 'A' })
    await emitEvent({ t: 'read', cid: 'c1', uid: 'ua' })
    await emitEvent({ t: 'notif', uid: 'ub' })
    await wait(300)

    expect(a1.events.find((e) => e.t === 'typing')).toBeUndefined() // no self-echo
    expect(b.events).toContainEqual({ t: 'typing', cid: 'c1', uid: 'ua', name: 'A' })
    expect(a1.events).toContainEqual({ t: 'read', cid: 'c1', uid: 'ua' })
    expect(a2.events).toContainEqual({ t: 'read', cid: 'c1', uid: 'ua' })
    expect(b.events.find((e) => e.t === 'read')).toBeUndefined()
    expect(b.events).toContainEqual({ t: 'notif', uid: 'ub' })
    expect(a1.events.find((e) => e.t === 'notif')).toBeUndefined()
  })

  it("'member' reloads the target user's subscriptions before delivery", async () => {
    const a = collector()
    const ids = new Set(['c1'])
    subscribe({ userId: 'ua', conversationIds: ids, reload: async () => new Set(['c1', 'c9']), send: a.send })
    await wait(300)
    await emitEvent({ t: 'member', cid: 'c9', uid: 'ua' })
    await wait(300)
    await emitEvent({ t: 'msg', cid: 'c9', mid: 'm9' }) // only visible if reload applied
    await wait(300)
    expect(a.events).toContainEqual({ t: 'member', cid: 'c9', uid: 'ua' })
    expect(a.events).toContainEqual({ t: 'msg', cid: 'c9', mid: 'm9' })
  })

  it('broadcasts issue events to every subscriber regardless of membership', async () => {
    const received: string[] = []
    const unsub = subscribe({
      userId: 'nonmember', conversationIds: new Set(), reload: async () => new Set(),
      send: (e) => { if (e.t === 'issue' || e.t === 'issue_move' || e.t === 'issue_comment') received.push(e.t) },
    })
    await wait(300) // listener connects — LOAD-BEARING, see note below
    // dispatch() is internal; drive it through the real pg NOTIFY path via emitEvent.
    await emitEvent({ t: 'issue', id: 'i1' })
    await emitEvent({ t: 'issue_comment', issueId: 'i1' })
    await wait(300) // allow the LISTEN round-trip
    unsub()
    expect(received).toEqual(['issue', 'issue_comment'])
  })
})
