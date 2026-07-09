import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeMessage } from '../factories'

describe('chat schema', () => {
  beforeEach(resetDb)

  it('enforces one membership row per user per conversation', async () => {
    const u = await makeUser()
    const c = await makeChannel()
    await prisma.conversationMember.create({ data: { conversationId: c.id, userId: u.id } })
    await expect(
      prisma.conversationMember.create({ data: { conversationId: c.id, userId: u.id } }),
    ).rejects.toThrow()
  })

  it('enforces reaction uniqueness per (message, user, emoji)', async () => {
    const u = await makeUser()
    const c = await makeChannel()
    const m = await makeMessage(c.id, u.id)
    await prisma.reaction.create({ data: { messageId: m.id, userId: u.id, emoji: '👍' } })
    await expect(
      prisma.reaction.create({ data: { messageId: m.id, userId: u.id, emoji: '👍' } }),
    ).rejects.toThrow()
    await prisma.reaction.create({ data: { messageId: m.id, userId: u.id, emoji: '🎉' } }) // different emoji OK
  })

  it('enforces slackTs idempotency per conversation and maintains the FTS column', async () => {
    const u = await makeUser()
    const c = await makeChannel()
    await makeMessage(c.id, u.id, { body: 'graphene growth run tomorrow', slackTs: '1111.222' })
    await expect(makeMessage(c.id, u.id, { slackTs: '1111.222' })).rejects.toThrow()
    const hits = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Message" WHERE search @@ websearch_to_tsquery('english', ${'graphene'})`
    expect(hits).toHaveLength(1)
  })

  it('dmKey uniqueness dedupes DM conversations', async () => {
    await prisma.conversation.create({ data: { type: 'DM', createdById: 'x', dmKey: 'a|b' } })
    await expect(
      prisma.conversation.create({ data: { type: 'DM', createdById: 'y', dmKey: 'a|b' } }),
    ).rejects.toThrow()
  })
})
