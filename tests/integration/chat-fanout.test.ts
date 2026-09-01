import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeDm, makeMember } from '../factories'
import { resetRate } from '@/features/chat/rate-limit'
import { _resetForTests } from '@/lib/events'
import { _resetActivityForTests } from '@/lib/activity'
import { _resetSquelchForTests } from '@/lib/push-squelch'
import { fanoutMessage } from '@/features/chat/fanout'

describe('fanoutMessage', () => {
  beforeEach(async () => {
    await resetDb(); resetRate()
    _resetActivityForTests(); _resetSquelchForTests()
  })
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

  it('DM: bell for all; push to every IDLE member (online or not); email only for offline', async () => {
    const a = await makeUser({ name: 'A' })
    const b = await makeUser() // online, idle
    const c = await makeUser() // offline, idle
    const d = await makeUser() // online, ACTIVE
    const dm = await makeDm([a.id, b.id, c.id, d.id])
    const push = vi.fn().mockResolvedValue(undefined)
    const hasLive = (uid: string) => uid === b.id || uid === d.id
    const isActive = (uid: string) => uid === d.id
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: dm.id } })
    await fanoutMessage(
      { message: msg({ conversationId: dm.id, userId: a.id }) as never, conversation: convo, senderName: 'A' },
      { hasLive, isActive, push },
    )
    expect(await prisma.notification.count({ where: { type: 'message_dm' } })).toBe(3) // b, c, d
    expect(await prisma.emailOutbox.count()).toBe(1) // only offline c
    // Push is activity-gated, NOT connection-gated: idle b gets push despite
    // the live SSE connection; active d gets none.
    expect(push.mock.calls.map((x) => x[0]).sort()).toEqual([b.id, c.id].sort())
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
      { hasLive: () => false, isActive: () => false, push },
    )
    expect(await prisma.notification.count()).toBe(0)
    expect(await prisma.emailOutbox.count()).toBe(0)
    expect(push).not.toHaveBeenCalled()
  })

  it('DM mute: plain message alerts nothing; a direct mention pierces bell AND alert', async () => {
    const a = await makeUser({ name: 'A' })
    const mutedB = await makeUser()
    const dm = await makeDm([a.id, mutedB.id])
    await prisma.conversationMember.updateMany({ where: { conversationId: dm.id, userId: mutedB.id }, data: { muted: true } })
    const push = vi.fn().mockResolvedValue(undefined)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: dm.id } })
    const seams = { hasLive: () => true, isActive: () => false, push }

    await fanoutMessage({ message: msg({ conversationId: dm.id, userId: a.id }) as never, conversation: convo, senderName: 'A' }, seams)
    expect(await prisma.notification.count({ where: { userId: mutedB.id } })).toBe(0)
    expect(push).not.toHaveBeenCalled()

    await fanoutMessage({ message: msg({ conversationId: dm.id, userId: a.id, mentionUserIds: [mutedB.id], id: 'm6' }) as never, conversation: convo, senderName: 'A' }, seams)
    expect(await prisma.notification.count({ where: { userId: mutedB.id, type: 'message_dm' } })).toBe(1)
    expect(push).toHaveBeenCalledTimes(1) // mention pierces mute for the alert too
    expect(push.mock.calls[0][0]).toBe(mutedB.id)
  })

  it('channel mention to an offline recipient: bell + mention email + push with the Slack-shaped payload', async () => {
    const { sender, rcpt, ch } = await setup()
    const push = vi.fn().mockResolvedValue(undefined)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: ch.id } })
    await fanoutMessage(
      { message: msg({ conversationId: ch.id, userId: sender.id, mentionUserIds: [rcpt.id], id: 'm8' }) as never, conversation: convo, senderName: 'Sender' },
      { hasLive: (uid) => uid !== rcpt.id, isActive: () => false, push },
    )
    expect(await prisma.notification.count({ where: { userId: rcpt.id, type: 'message_mention' } })).toBe(1)
    expect(await prisma.emailOutbox.count()).toBe(1)
    expect((await prisma.emailOutbox.findFirstOrThrow()).toEmail).toBe(rcpt.email)
    expect(push).toHaveBeenCalledTimes(1)
    const payload = push.mock.calls[0][1]
    expect(payload).toMatchObject({ tag: ch.id, url: `/chat/${ch.id}?msg=m8` })
    expect(payload.title).toBe('#general')
    expect(payload.body).toBe('Sender: hello team')
  })

  it('channel plain message: still no bell rows, but push to idle members — and live connections no longer gate push', async () => {
    const { sender, rcpt, ch } = await setup()
    const activeUser = await makeUser()
    await makeMember(ch.id, activeUser.id)
    const push = vi.fn().mockResolvedValue(undefined)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: ch.id } })
    await fanoutMessage(
      { message: msg({ conversationId: ch.id, userId: sender.id, id: 'm2' }) as never, conversation: convo, senderName: 'Sender' },
      { hasLive: () => true, isActive: (uid) => uid === activeUser.id, push }, // everyone "online"
    )
    expect(await prisma.notification.count()).toBe(0) // bell policy unchanged
    expect(push).toHaveBeenCalledTimes(1) // only rcpt (idle); mutedUser muted; activeUser active
    expect(push.mock.calls[0][0]).toBe(rcpt.id)
    expect(push.mock.calls[0][1]).toMatchObject({ tag: ch.id, url: `/chat/${ch.id}?msg=m2` })
    expect(push.mock.calls[0][1].title).toBe('#general')
    expect(push.mock.calls[0][1].body).toBe('Sender: hello team')
  })

  it('@channel: bell for unmuted members; muted members get neither bell nor push', async () => {
    const { sender, rcpt, mutedUser, ch } = await setup()
    const push = vi.fn().mockResolvedValue(undefined)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: ch.id } })
    await fanoutMessage(
      { message: msg({ conversationId: ch.id, userId: sender.id, mentionsChannel: true, id: 'm7' }) as never, conversation: convo, senderName: 'Sender' },
      { hasLive: () => true, isActive: () => false, push },
    )
    expect(await prisma.notification.count({ where: { userId: rcpt.id, type: 'message_mention' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: mutedUser.id } })).toBe(0)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toBe(rcpt.id)
  })

  it('squelch: a second push to the same (user, conversation) inside 60s is swallowed; the bell is NOT squelched', async () => {
    const { sender, rcpt, ch } = await setup()
    const push = vi.fn().mockResolvedValue(undefined)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: ch.id } })
    const seams = { hasLive: () => true, isActive: () => false, push }
    await fanoutMessage({ message: msg({ conversationId: ch.id, userId: sender.id, mentionUserIds: [rcpt.id], id: 'm4' }) as never, conversation: convo, senderName: 'Sender' }, seams)
    await fanoutMessage({ message: msg({ conversationId: ch.id, userId: sender.id, mentionUserIds: [rcpt.id], id: 'm5' }) as never, conversation: convo, senderName: 'Sender' }, seams)
    expect(push).toHaveBeenCalledTimes(1)
    expect(await prisma.notification.count()).toBe(2)
  })

  it('bot senders never alert (no push); bell rules for @channel are unchanged', async () => {
    const bot = await prisma.user.create({ data: { id: 'bot-fixture', name: 'Bot', email: `bot-${Date.now()}@test.local`, emailVerified: true, isSystem: true } })
    const { rcpt, ch } = await setup()
    await makeMember(ch.id, bot.id)
    const push = vi.fn().mockResolvedValue(undefined)
    const convo = await prisma.conversation.findUniqueOrThrow({ where: { id: ch.id } })
    await fanoutMessage(
      { message: msg({ conversationId: ch.id, userId: bot.id, mentionsChannel: true }) as never, conversation: convo, senderName: 'Bot' },
      { hasLive: () => false, isActive: () => false, push },
    )
    expect(await prisma.notification.count({ where: { userId: rcpt.id } })).toBe(1) // @channel bell still fires
    expect(push).not.toHaveBeenCalled() // but bot chatter must never buzz phones
  })
})
