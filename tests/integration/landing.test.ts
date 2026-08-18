import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser, makeChannel, makeMember } from '../factories'
import { prisma } from '@/lib/db'
import { landingHrefFor } from '@/lib/landing'

describe('landingHrefFor', () => {
  beforeEach(resetDb)
  it('falls back without a remembered conversation, membership loss, archive, and null user', async () => {
    const u = await makeUser()
    expect(await landingHrefFor(null)).toBe('/issues/me')
    expect(await landingHrefFor(u.id)).toBe('/issues/me')
    // makeChannel carries the schema-required createdById ('seed').
    const c = await makeChannel()
    await makeMember(c.id, u.id)
    await prisma.user.update({ where: { id: u.id }, data: { lastConversationId: c.id } })
    expect(await landingHrefFor(u.id)).toBe(`/chat/${c.id}`)
    await prisma.conversation.update({ where: { id: c.id }, data: { archivedAt: new Date() } })
    expect(await landingHrefFor(u.id)).toBe('/issues/me')
    await prisma.conversation.update({ where: { id: c.id }, data: { archivedAt: null } })
    await prisma.conversationMember.delete({ where: { conversationId_userId: { conversationId: c.id, userId: u.id } } })
    expect(await landingHrefFor(u.id)).toBe('/issues/me')
  })
})
