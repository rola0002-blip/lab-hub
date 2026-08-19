import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeMember, makeMessage } from '../factories'
import { resetRate } from '@/features/chat/rate-limit'
import { _resetForTests } from '@/lib/events'
import { sendMessage, deleteMessage, setPinned, listPinned } from '@/features/chat/message-service'

// W4-A1 pinned messages: membership + role gates, re-stamp semantics, tombstone
// rules, and the listPinned read behind the header popover. SSE emit is
// fire-and-forget and deliberately unasserted (same as the reactions tests).
describe('message pinning', () => {
  beforeEach(async () => { await resetDb(); resetRate() })
  afterEach(() => _resetForTests())

  async function channelWith(...roles: string[]) {
    const users = await Promise.all(roles.map((role) => makeUser({ role })))
    const ch = await makeChannel()
    await Promise.all(users.map((u) => makeMember(ch.id, u.id)))
    return { ch, users }
  }

  it('members pin; a second pin re-stamps; unpin nulls pinnedAt', async () => {
    const { ch, users: [a] } = await channelWith('member')
    const r = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'pin me' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const p1 = await setPinned({ messageId: r.message.id, userId: a.id, role: 'member', pinned: true })
    expect(p1.ok).toBe(true)
    if (!p1.ok) return
    expect(p1.message.pinnedAt).toBeTruthy()
    await new Promise((res) => setTimeout(res, 10)) // ensure a strictly later timestamp
    const p2 = await setPinned({ messageId: r.message.id, userId: a.id, role: 'member', pinned: true })
    expect(p2.ok && p2.message.pinnedAt).toBeTruthy()
    expect(p2.ok && p2.message.pinnedAt).not.toBe(p1.message.pinnedAt) // re-pinning re-stamps (newest-pinned-first sort)
    const u = await setPinned({ messageId: r.message.id, userId: a.id, role: 'member', pinned: false })
    expect(u.ok && u.message.pinnedAt).toBeNull()
    expect((await prisma.message.findUniqueOrThrow({ where: { id: r.message.id } })).pinnedAt).toBeNull()
  })

  it('guests and non-members are forbidden; a missing message shares the same shape (no existence leak)', async () => {
    const { ch, users: [m, g] } = await channelWith('member', 'guest')
    const outsider = await makeUser()
    const r = await sendMessage({ userId: m.id, conversationId: ch.id, body: 'x' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(await setPinned({ messageId: r.message.id, userId: g.id, role: 'guest', pinned: true }))
      .toMatchObject({ ok: false, error: 'forbidden', message: 'Guests cannot pin messages.' })
    const nonMember = await setPinned({ messageId: r.message.id, userId: outsider.id, role: 'member', pinned: true })
    const missing = await setPinned({ messageId: 'does-not-exist', userId: m.id, role: 'member', pinned: true })
    expect(nonMember).toEqual(missing) // identical shape + message string
    expect(nonMember).toMatchObject({ ok: false, error: 'forbidden', message: 'Message not found.' })
  })

  it('pinning a deleted message is invalid; unpinning a tombstone is a no-op success', async () => {
    const { ch, users: [a] } = await channelWith('member')
    const r = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'doomed' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(await deleteMessage({ messageId: r.message.id, userId: a.id })).toMatchObject({ ok: true })
    expect(await setPinned({ messageId: r.message.id, userId: a.id, role: 'member', pinned: true }))
      .toMatchObject({ ok: false, error: 'invalid', message: 'Deleted messages cannot be pinned.' })
    const noop = await setPinned({ messageId: r.message.id, userId: a.id, role: 'member', pinned: false })
    expect(noop.ok).toBe(true) // unpin on a tombstone: no-op success
    if (!noop.ok) return
    expect(noop.message.deleted).toBe(true)
    expect((await prisma.message.findUniqueOrThrow({ where: { id: r.message.id } })).pinnedAt).toBeNull()
  })

  it('listPinned: membership-gated, excludes tombstones, sorts pinnedAt desc', async () => {
    const { ch, users: [a] } = await channelWith('member')
    const outsider = await makeUser()
    const base = Date.now()
    const oldest = await makeMessage(ch.id, a.id, { body: 'pinned first', pinnedAt: new Date(base - 30_000), createdAt: new Date(base - 50_000) })
    const newest = await makeMessage(ch.id, a.id, { body: 'pinned last', pinnedAt: new Date(base - 5_000), createdAt: new Date(base - 40_000) })
    await makeMessage(ch.id, a.id, { body: 'unpinned', createdAt: new Date(base - 10_000) })
    // A tombstone that was pinned before deletion must not surface in the popover.
    const tomb = await makeMessage(ch.id, a.id, { body: 'pinned then deleted', pinnedAt: new Date(base - 20_000), deletedAt: new Date(base - 1_000) })

    expect(await listPinned({ conversationId: ch.id, userId: outsider.id })).toBeNull() // membership gate
    const rows = await listPinned({ conversationId: ch.id, userId: a.id })
    expect(rows?.map((m) => m.id)).toEqual([newest.id, oldest.id]) // newest-pinned first, tombstone + unpinned excluded
    expect(rows?.every((m) => m.pinnedAt)).toBe(true)
    expect(rows?.some((m) => m.id === tomb.id)).toBe(false)
  })
})
