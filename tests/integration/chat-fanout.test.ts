import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeDm, makeMember } from '../factories'
import { resetRate } from '@/features/chat/rate-limit'
import { _resetForTests } from '@/lib/events'
import { fanoutMessage } from '@/features/chat/fanout'

describe('fanoutMessage', () => {
  beforeEach(async () => { await resetDb(); resetRate() })
  afterEach(() => _resetForTests())

  async function setup() {
    const sender = await makeUser({ name: 'Sender' })
    const rcpt = await makeUser()
    const mutedUser = await makeUser()
    const ch = await makeChannel({ name: 'general' })
    await Promise.all([makeMember(ch.id, sender.id), makeMember(ch.id, rcpt.id), makeMember(ch.id, mutedUser.id, { muted: true })])
    return { sender, rcpt, mutedUser, ch }
  }
  const msg = (over: Record<string, unknown>) => ({
    id: 'm1', body: 'hello team', parentId: null, editedAt: null, deletedAt: null, slackTs: null,
    createdAt: new Date(), mentionUserIds: [], mentionsChannel: false, ...over,
  })

  it('DM: all other members notified; offline ones get email+push, online ones neither', async () => {
    const a = await makeUser({ name: 'A' })
    const b = await makeUser()
    const c = await makeUser()
    const dm = await makeDm([a.id, b.id, c.id])
    const push = vi.fn().mockResolvedValue(undefined)
    const hasLive = (uid: string) => uid === b.id // b online, c offline
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: dm.id } })
    await fanoutMessage(
      { message: msg({ conversationId: dm.id, userId: a.id }) as never, conversation: convo, senderName: 'A' },
      { hasLive, push },
    )
    expect(await prisma.notification.count({ where: { type: 'message_dm' } })).toBe(2) // b and c
    expect(await prisma.emailOutbox.count()).toBe(1) // only offline c
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toBe(c.id)
  })

  it('skips banned members even when directly mentioned', async () => {
    const sender = await makeUser({ name: 'Sender' })
    const banned = await makeUser({ banned: true })
    const ch = await makeChannel({ name: 'general' })
    await Promise.all([makeMember(ch.id, sender.id), makeMember(ch.id, banned.id)])
    const push = vi.fn().mockResolvedValue(undefined)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: ch.id } })
    await fanoutMessage(
      { message: msg({ conversationId: ch.id, userId: sender.id, mentionUserIds: [banned.id] }) as never, conversation: convo, senderName: 'Sender' },
      { hasLive: () => false, push }, // offline: would email+push if not skipped
    )
    expect(await prisma.notification.count()).toBe(0) // banned member skipped before notify
    expect(await prisma.emailOutbox.count()).toBe(0)
    expect(push).not.toHaveBeenCalled()
  })

  it('DM mute suppresses plain messages but a direct mention still pierces', async () => {
    const a = await makeUser({ name: 'A' })
    const mutedB = await makeUser()
    const dm = await makeDm([a.id, mutedB.id])
    await prisma.conversationMember.updateMany({ where: { conversationId: dm.id, userId: mutedB.id }, data: { muted: true } })
    const push = vi.fn().mockResolvedValue(undefined)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: dm.id } })
    const seams = { hasLive: () => true, push }

    await fanoutMessage({ message: msg({ conversationId: dm.id, userId: a.id }) as never, conversation: convo, senderName: 'A' }, seams)
    expect(await prisma.notification.count({ where: { userId: mutedB.id } })).toBe(0) // plain DM suppressed by mute

    await fanoutMessage({ message: msg({ conversationId: dm.id, userId: a.id, mentionUserIds: [mutedB.id] }) as never, conversation: convo, senderName: 'A' }, seams)
    expect(await prisma.notification.count({ where: { userId: mutedB.id, type: 'message_dm' } })).toBe(1) // direct mention pierces mute in a DM
  })

  it('channel mention to an offline recipient queues a mention email and a push', async () => {
    const { sender, rcpt, ch } = await setup()
    const push = vi.fn().mockResolvedValue(undefined)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: ch.id } })
    await fanoutMessage(
      { message: msg({ conversationId: ch.id, userId: sender.id, mentionUserIds: [rcpt.id] }) as never, conversation: convo, senderName: 'Sender' },
      { hasLive: (uid) => uid !== rcpt.id, push }, // rcpt offline
    )
    expect(await prisma.notification.count({ where: { userId: rcpt.id, type: 'message_mention' } })).toBe(1)
    expect(await prisma.emailOutbox.count()).toBe(1) // offline → mentionEmail queued
    expect((await prisma.emailOutbox.findFirstOrThrow()).toEmail).toBe(rcpt.email)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toBe(rcpt.id)
  })

  it('channel: direct mentions pierce mute; @channel does not; plain messages notify nobody', async () => {
    const { sender, rcpt, mutedUser, ch } = await setup()
    const push = vi.fn().mockResolvedValue(undefined)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: ch.id } })
    const seams = { hasLive: () => true, push } // everyone online → no email/push, in-app only

    await fanoutMessage({ message: msg({ conversationId: ch.id, userId: sender.id }) as never, conversation: convo, senderName: 'Sender' }, seams)
    expect(await prisma.notification.count()).toBe(0)

    await fanoutMessage({ message: msg({ conversationId: ch.id, userId: sender.id, mentionsChannel: true }) as never, conversation: convo, senderName: 'Sender' }, seams)
    expect(await prisma.notification.count({ where: { userId: rcpt.id, type: 'message_mention' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: mutedUser.id } })).toBe(0) // mute holds vs @channel

    await fanoutMessage(
      { message: msg({ conversationId: ch.id, userId: sender.id, mentionUserIds: [mutedUser.id] }) as never, conversation: convo, senderName: 'Sender' },
      seams,
    )
    expect(await prisma.notification.count({ where: { userId: mutedUser.id, type: 'message_mention' } })).toBe(1) // direct mention pierces
    expect(push).not.toHaveBeenCalled() // everyone live
  })
})
