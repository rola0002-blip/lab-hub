import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeDm, makeMember, makeMessage } from '../factories'
import { resetRate } from '@/features/chat/rate-limit'
import { _resetForTests } from '@/lib/events'
import { _resetActivityForTests } from '@/lib/activity'
import { _resetSquelchForTests } from '@/lib/push-squelch'
import {
  markNotificationsRead, markNotificationsReadUpTo, clearConversationBells, settleCaughtUpBells,
} from '@/lib/notification-read'
import { markRead } from '@/features/chat/message-service'
import { fanoutMessage } from '@/features/chat/fanout'

// getSessionUser is the single auth seam for the route (the feedback-api idiom).
const session = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => session.current,
  requireUser: async () => session.current,
  requireAdmin: async () => session.current,
}))

import { POST as readRoute } from '@/app/api/notifications/read/route'

// Explicit instants throughout — never same-millisecond timing.
const T = new Date('2026-11-01T10:00:00.000Z')
const at = (sec: number) => new Date(T.getTime() + sec * 1000)

async function bell(userId: string, over: { type?: string; payload?: Record<string, unknown>; createdAt?: Date; readAt?: Date | null } = {}) {
  return prisma.notification.create({
    data: {
      userId, type: over.type ?? 'message_dm', payload: (over.payload ?? {}) as never,
      createdAt: over.createdAt ?? T, readAt: over.readAt ?? null,
    },
  })
}
const readAtOf = async (id: string) => (await prisma.notification.findUniqueOrThrow({ where: { id } })).readAt

describe('notification-read', () => {
  beforeEach(async () => {
    await resetDb(); resetRate()
    _resetActivityForTests(); _resetSquelchForTests()
    session.current = null
  })
  afterEach(() => _resetForTests())

  describe('markNotificationsReadUpTo', () => {
    it('reads every own unread row at or before upTo; later rows, read rows and other users stay', async () => {
      const u = await makeUser()
      const other = await makeUser()
      const older2 = await bell(u.id, { createdAt: at(-2) })
      const older1 = await bell(u.id, { createdAt: at(-1) })
      const exact = await bell(u.id, { createdAt: T })
      const later = await bell(u.id, { createdAt: at(1) })
      const originalReadAt = at(-3600)
      const alreadyRead = await bell(u.id, { createdAt: at(-5), readAt: originalReadAt })
      const foreign = await bell(other.id, { createdAt: at(-2) })

      expect(await markNotificationsReadUpTo(u.id, T)).toBe(3)
      for (const r of [older2, older1, exact]) expect(await readAtOf(r.id)).not.toBeNull()
      expect(await readAtOf(later.id)).toBeNull()
      expect(await readAtOf(alreadyRead.id)).toEqual(originalReadAt) // never re-stamped
      expect(await readAtOf(foreign.id)).toBeNull()
    })
  })

  describe('markNotificationsRead (legacy ids path)', () => {
    it('reads only the caller\'s own ids', async () => {
      const u = await makeUser()
      const other = await makeUser()
      const mine = await bell(u.id)
      const theirs = await bell(other.id)
      expect(await markNotificationsRead(u.id, [mine.id, theirs.id])).toBe(1)
      expect(await readAtOf(mine.id)).not.toBeNull()
      expect(await readAtOf(theirs.id)).toBeNull()
    })
    it('returns 0 for an empty list', async () => {
      const u = await makeUser()
      expect(await markNotificationsRead(u.id, [])).toBe(0)
    })
  })

  describe('clearConversationBells', () => {
    it('reads DM/mention bells for root messages <= upTo of THIS conversation only', async () => {
      const u = await makeUser()
      const peer = await makeUser()
      const convA = await makeChannel()
      const convB = await makeChannel()
      const root1 = await makeMessage(convA.id, peer.id, { createdAt: at(-10) })
      const root2 = await makeMessage(convA.id, peer.id, { createdAt: at(-5) })
      const reply = await makeMessage(convA.id, peer.id, { createdAt: at(-4), parentId: root1.id })
      const lateRoot = await makeMessage(convA.id, peer.id, { createdAt: at(5) })
      const rootB = await makeMessage(convB.id, peer.id, { createdAt: at(-5) })
      const p = (cid: string, mid?: string) => (mid ? { conversationId: cid, messageId: mid } : { conversationId: cid })

      const dmRoot = await bell(u.id, { type: 'message_dm', payload: p(convA.id, root1.id) })
      const mentionRoot = await bell(u.id, { type: 'message_mention', payload: p(convA.id, root2.id) })
      const threadReply = await bell(u.id, { type: 'message_thread_reply', payload: p(convA.id, reply.id) })
      const dmOnReply = await bell(u.id, { type: 'message_dm', payload: p(convA.id, reply.id) })
      const otherConv = await bell(u.id, { type: 'message_dm', payload: p(convB.id, rootB.id) })
      const foreign = await bell(peer.id, { type: 'message_dm', payload: p(convA.id, root1.id) })
      const noMessageId = await bell(u.id, { type: 'message_dm', payload: p(convA.id) })
      const afterUpTo = await bell(u.id, { type: 'message_dm', payload: p(convA.id, lateRoot.id) })

      expect(await clearConversationBells({ userId: u.id, conversationId: convA.id, upTo: T })).toBe(2)
      expect(await readAtOf(dmRoot.id)).not.toBeNull()
      expect(await readAtOf(mentionRoot.id)).not.toBeNull()
      for (const r of [threadReply, dmOnReply, otherConv, foreign, noMessageId, afterUpTo]) {
        expect(await readAtOf(r.id)).toBeNull()
      }
    })

    it('returns 0 when nothing matches', async () => {
      const u = await makeUser()
      const ch = await makeChannel()
      expect(await clearConversationBells({ userId: u.id, conversationId: ch.id, upTo: T })).toBe(0)
    })

    it('returns 0 when the rows name only replies or later messages (no root qualifies)', async () => {
      const u = await makeUser()
      const peer = await makeUser()
      const ch = await makeChannel()
      const root = await makeMessage(ch.id, peer.id, { createdAt: at(-10) })
      const reply = await makeMessage(ch.id, peer.id, { createdAt: at(-5), parentId: root.id })
      const later = await makeMessage(ch.id, peer.id, { createdAt: at(5) })
      const onReply = await bell(u.id, { type: 'message_mention', payload: { conversationId: ch.id, messageId: reply.id } })
      const onLater = await bell(u.id, { type: 'message_mention', payload: { conversationId: ch.id, messageId: later.id } })
      expect(await clearConversationBells({ userId: u.id, conversationId: ch.id, upTo: T })).toBe(0)
      expect(await readAtOf(onReply.id)).toBeNull()
      expect(await readAtOf(onLater.id)).toBeNull()
    })
  })

  describe('markRead (chat)', () => {
    it('a member reading the conversation clears its root-message bells', async () => {
      const me = await makeUser()
      const peer = await makeUser()
      const dm = await makeDm([me.id, peer.id])
      const m = await makeMessage(dm.id, peer.id, { createdAt: at(-60) })
      const row = await bell(me.id, { type: 'message_dm', payload: { conversationId: dm.id, messageId: m.id } })
      await markRead({ userId: me.id, conversationId: dm.id })
      expect(await readAtOf(row.id)).not.toBeNull()
    })

    it('a non-member (rows for a conversation they left) is untouched', async () => {
      const me = await makeUser()
      const peer = await makeUser()
      const ch = await makeChannel()
      await makeMember(ch.id, peer.id)
      const m = await makeMessage(ch.id, peer.id, { createdAt: at(-60) })
      const row = await bell(me.id, { type: 'message_mention', payload: { conversationId: ch.id, messageId: m.id } })
      await markRead({ userId: me.id, conversationId: ch.id })
      expect(await readAtOf(row.id)).toBeNull()
    })
  })

  describe('fanoutMessage settles caught-up readers', () => {
    const seams = { hasLive: () => true, isActive: () => false, push: vi.fn().mockResolvedValue(undefined), canPush: () => false }

    it('a member whose cursor is past the message gets a read row; one behind stays unread', async () => {
      const a = await makeUser({ name: 'A' })
      const b = await makeUser()
      const c = await makeUser()
      const dm = await makeDm([a.id, b.id, c.id])
      const m = await makeMessage(dm.id, a.id, { createdAt: T })
      await prisma.conversationMember.updateMany({ where: { conversationId: dm.id, userId: b.id }, data: { lastReadAt: at(1) } })
      await prisma.conversationMember.updateMany({ where: { conversationId: dm.id, userId: c.id }, data: { lastReadAt: at(-1) } })
      const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: dm.id } })

      await fanoutMessage({ message: m, conversation: convo, senderName: 'A' }, seams)
      const rowB = await prisma.notification.findFirstOrThrow({ where: { userId: b.id, type: 'message_dm' } })
      const rowC = await prisma.notification.findFirstOrThrow({ where: { userId: c.id, type: 'message_dm' } })
      expect(rowB.readAt).not.toBeNull()
      expect(rowC.readAt).toBeNull()
    })

    it('a reply is never settled, even for a caught-up reader', async () => {
      const a = await makeUser({ name: 'A' })
      const b = await makeUser()
      const dm = await makeDm([a.id, b.id])
      const root = await makeMessage(dm.id, a.id, { createdAt: at(-10) })
      const reply = await makeMessage(dm.id, a.id, { createdAt: T, parentId: root.id })
      await prisma.conversationMember.updateMany({ where: { conversationId: dm.id, userId: b.id }, data: { lastReadAt: at(1) } })
      const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: dm.id } })

      await fanoutMessage({ message: reply, conversation: convo, senderName: 'A' }, seams)
      const rowB = await prisma.notification.findFirstOrThrow({ where: { userId: b.id, type: 'message_dm' } })
      expect(rowB.readAt).toBeNull()
    })

    it('settleCaughtUpBells returns exactly the users it settled', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const c = await makeUser()
      const dm = await makeDm([a.id, b.id, c.id])
      const m = await makeMessage(dm.id, a.id, { createdAt: T })
      await prisma.conversationMember.updateMany({ where: { conversationId: dm.id, userId: b.id }, data: { lastReadAt: at(1) } })
      await prisma.conversationMember.updateMany({ where: { conversationId: dm.id, userId: c.id }, data: { lastReadAt: at(-1) } })
      const p = { conversationId: dm.id, messageId: m.id }
      const rowB = await bell(b.id, { type: 'message_dm', payload: p })
      const rowC = await bell(c.id, { type: 'message_dm', payload: p })

      expect(await settleCaughtUpBells(m, [b.id, c.id])).toEqual([b.id])
      expect(await readAtOf(rowB.id)).not.toBeNull()
      expect(await readAtOf(rowC.id)).toBeNull()
      expect(await settleCaughtUpBells(m, [])).toEqual([])
      expect(await settleCaughtUpBells({ ...m, parentId: 'x' }, [b.id])).toEqual([])
    })

    it('a caught-up reader whose row is already read settles nothing', async () => {
      const a = await makeUser()
      const b = await makeUser()
      const dm = await makeDm([a.id, b.id])
      const m = await makeMessage(dm.id, a.id, { createdAt: T })
      await prisma.conversationMember.updateMany({ where: { conversationId: dm.id, userId: b.id }, data: { lastReadAt: at(1) } })
      const firstRead = at(2)
      const row = await bell(b.id, { type: 'message_dm', payload: { conversationId: dm.id, messageId: m.id }, readAt: firstRead })
      expect(await settleCaughtUpBells(m, [b.id])).toEqual([])
      expect(await readAtOf(row.id)).toEqual(firstRead) // never re-stamped
    })
  })

  describe('POST /api/notifications/read', () => {
    const req = (body: string) => readRoute(new Request('http://t/api/notifications/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }))
    async function signIn() {
      const u = await makeUser()
      session.current = { id: u.id, name: u.name, email: u.email, role: 'member' }
      return u
    }

    it('{ upTo } reads every row up to that instant', async () => {
      const u = await signIn()
      const old = await bell(u.id, { createdAt: at(-100) })
      const later = await bell(u.id, { createdAt: at(1) })
      const res = await req(JSON.stringify({ upTo: T.toISOString() }))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(await readAtOf(old.id)).not.toBeNull()
      expect(await readAtOf(later.id)).toBeNull()
    })

    it('{ ids } (legacy tabs) reads exactly those rows', async () => {
      const u = await signIn()
      const a = await bell(u.id)
      const b = await bell(u.id)
      const res = await req(JSON.stringify({ ids: [a.id] }))
      expect(res.status).toBe(200)
      expect(await readAtOf(a.id)).not.toBeNull()
      expect(await readAtOf(b.id)).toBeNull()
    })

    it('malformed JSON is a 400, not a 500', async () => {
      await signIn()
      expect((await req('{not json')).status).toBe(400)
    })

    it('a non-ISO upTo is a 400', async () => {
      await signIn()
      expect((await req(JSON.stringify({ upTo: 'nope' }))).status).toBe(400)
    })

    it('a year-0 upTo (valid ISO, rejected by Postgres) is a 400, never a 500', async () => {
      await signIn()
      expect((await req(JSON.stringify({ upTo: '0000-01-01T00:00:00Z' }))).status).toBe(400)
    })

    it('no session is a 401', async () => {
      expect((await req(JSON.stringify({ upTo: T.toISOString() }))).status).toBe(401)
    })
  })
})
