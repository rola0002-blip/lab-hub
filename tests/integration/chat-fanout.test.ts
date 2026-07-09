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
