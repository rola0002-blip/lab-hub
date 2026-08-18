import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeMember } from '../factories'
import { resetRate } from '@/features/chat/rate-limit'
import { _resetForTests } from '@/lib/events'
import { sendMessage } from '@/features/chat/message-service'
import { fanoutMessage, fanoutThreadReply } from '@/features/chat/fanout'

// Both fan-outs are fire-and-forget (`void …`), so a skipped call reads the
// same as an unfinished one at assertion time. Wrap the REAL implementations in
// spies (delegating, so the behavioral row assertions stay real): the CALL is
// synchronous, which makes the not-called assertions in the suppression test
// deterministic and mutation-killing. Same idiom as suppress-notify.test.ts.
vi.mock('@/features/chat/fanout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat/fanout')>()
  return {
    ...actual,
    fanoutMessage: vi.fn(actual.fanoutMessage),
    fanoutThreadReply: vi.fn(actual.fanoutThreadReply),
  }
})
const fanoutSpy = vi.mocked(fanoutMessage)
const threadSpy = vi.mocked(fanoutThreadReply)

// The thread bell lands a few DB round-trips AFTER the send resolves (void
// fanoutThreadReply). Poll for it rather than assert synchronously — the same
// settle-barrier idiom as bot.test.ts / suppress-notify.test.ts.
const until = async (fn: () => Promise<boolean>, ms = 2000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)) }
}

describe('thread-reply bell (F8)', () => {
  beforeEach(async () => { await resetDb(); resetRate(); fanoutSpy.mockClear(); threadSpy.mockClear() })
  afterEach(() => _resetForTests())

  async function channelWith(...names: string[]) {
    const users = await Promise.all(names.map((name) => makeUser({ name })))
    const ch = await makeChannel()
    await Promise.all(users.map((u) => makeMember(ch.id, u.id)))
    return { ch, users }
  }

  it('bells the root author (once, payload-shaped) but never the replier; bell-only — no email', async () => {
    const { ch, users: [a, b] } = await channelWith('A', 'B')
    const root = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'root message' })
    expect(root.ok).toBe(true)
    if (!root.ok) return
    const reply = await sendMessage({ userId: b.id, conversationId: ch.id, body: 'a reply in the thread', parentId: root.message.id })
    expect(reply.ok).toBe(true)
    if (!reply.ok) return

    await until(async () => (await prisma.notification.count({ where: { userId: a.id, type: 'message_thread_reply' } })) === 1)
    // Exactly one thread bell for A, nothing at all for B (the sender).
    expect(await prisma.notification.count({ where: { userId: a.id, type: 'message_thread_reply' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: b.id } })).toBe(0)
    // Payload carries the deep-link trio plus the digest job's senderId.
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: a.id, type: 'message_thread_reply' } })
    const p = n.payload as { message: string; conversationId: string; messageId: string; senderId: string }
    expect(p.message).toContain('in a thread:')
    expect(p.conversationId).toBe(ch.id)
    expect(p.messageId).toBe(reply.message.id)
    expect(p.senderId).toBe(b.id)
    // Bell-only: no immediate email, and the row stays digest-eligible (no emailedAt).
    expect(await prisma.emailOutbox.count()).toBe(0)
    expect(n.emailedAt).toBeNull()
  })

  it('mention-wins: a later @-mention of a participant gives one mention bell, no second thread bell', async () => {
    const { ch, users: [a, c, d, e] } = await channelWith('A', 'C', 'D', 'E')
    const root = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'root' })
    expect(root.ok).toBe(true)
    if (!root.ok) return
    // D replies first, becoming a thread participant alongside root author A.
    // D's own reply bells only A (the sender is never a candidate).
    const dReply = await sendMessage({ userId: d.id, conversationId: ch.id, body: 'first reply', parentId: root.message.id })
    expect(dReply.ok).toBe(true)
    if (!dReply.ok) return
    await until(async () => (await prisma.notification.count({ where: { userId: a.id, type: 'message_thread_reply' } })) === 1)

    // C (another participant-to-be) replies: now D (participant) and A both get a thread bell.
    const cReply = await sendMessage({ userId: c.id, conversationId: ch.id, body: 'second reply', parentId: root.message.id })
    expect(cReply.ok).toBe(true)
    if (!cReply.ok) return
    await until(async () => (await prisma.notification.count({ where: { userId: d.id, type: 'message_thread_reply' } })) === 1)

    // E replies @-mentioning D: fanoutMessage bells D once (mention); the thread
    // fanout must NOT add another row for that same reply.
    const eReply = await sendMessage({ userId: e.id, conversationId: ch.id, body: `hey <@${d.id}> look`, parentId: root.message.id })
    expect(eReply.ok).toBe(true)
    if (!eReply.ok) return
    await until(async () => (await prisma.notification.count({ where: { userId: d.id, type: 'message_mention' } })) === 1)

    expect(await prisma.notification.count({ where: { userId: d.id, type: 'message_mention' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: d.id, type: 'message_thread_reply' } })).toBe(1) // unchanged by E's reply
    // D's only thread row is C's reply (D's own reply never belled D, E's mention reply was skipped).
    const dThreadRows = await prisma.notification.findMany({ where: { userId: d.id, type: 'message_thread_reply' } })
    expect(dThreadRows.map((r) => (r.payload as { messageId: string }).messageId)).toEqual([cReply.message.id])
    // Offline mention → immediate email → emailedAt latched (exempt from digest);
    // thread bells carry no email and stay unlatched.
    const mention = await prisma.notification.findFirstOrThrow({ where: { userId: d.id, type: 'message_mention' } })
    expect(mention.emailedAt).not.toBeNull()
    for (const r of dThreadRows) expect(r.emailedAt).toBeNull()
  })

  it('a muted participant gets nothing from later replies', async () => {
    const { ch, users: [a, b, m] } = await channelWith('A', 'B', 'M')
    const root = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'root' })
    expect(root.ok).toBe(true)
    if (!root.ok) return
    // M replies, becoming a participant, then mutes the conversation.
    const mReply = await sendMessage({ userId: m.id, conversationId: ch.id, body: 'my one reply', parentId: root.message.id })
    expect(mReply.ok).toBe(true)
    if (!mReply.ok) return
    await prisma.conversationMember.updateMany({ where: { conversationId: ch.id, userId: m.id }, data: { muted: true } })

    const later = await sendMessage({ userId: b.id, conversationId: ch.id, body: 'after the mute', parentId: root.message.id })
    expect(later.ok).toBe(true)
    if (!later.ok) return
    await until(async () => (await prisma.notification.count({ where: { userId: a.id, type: 'message_thread_reply' } })) === 2)

    // Control: the fan-out ran (A, unmuted root author, got bells from M's and B's
    // replies). M — a participant — got nothing from B's reply (own reply never
    // bells the sender, and mute holds afterwards).
    expect(await prisma.notification.count({ where: { userId: a.id, type: 'message_thread_reply' } })).toBe(2)
    expect(await prisma.notification.count({ where: { userId: m.id } })).toBe(0)
  })

  it('suppressNotify skips BOTH fan-outs for a thread reply (and the thread fan-out for a bot DM)', async () => {
    const { ch, users: [a, b] } = await channelWith('A', 'B')
    const root = await sendMessage({ userId: a.id, conversationId: ch.id, body: 'root', suppressNotify: true })
    expect(root.ok).toBe(true)
    if (!root.ok) return
    expect(fanoutSpy).not.toHaveBeenCalled()
    expect(threadSpy).not.toHaveBeenCalled()

    const reply = await sendMessage({ userId: b.id, conversationId: ch.id, body: 'silent reply', parentId: root.message.id, suppressNotify: true })
    expect(reply.ok).toBe(true)
    // Discriminating: a broken guard CALLS fan-out synchronously even though its
    // writes would land later. Neither fan-out may fire for a suppressed reply.
    expect(fanoutSpy).not.toHaveBeenCalled()
    expect(threadSpy).not.toHaveBeenCalled()
    expect(await prisma.notification.count()).toBe(0)
    expect(await prisma.emailOutbox.count()).toBe(0)
  })
})
