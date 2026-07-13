import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, seedSystem } from '../factories'
import { COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from '@/features/bot'

describe('SP5 schema + seed', () => {
  beforeEach(resetDb)

  it('adds isSystem, nullable-unique icsToken and Issue.dueSoonPingedAt', async () => {
    // Two token-less users coexist (nullable-unique allows many NULLs).
    const a = await makeUser()
    const b = await makeUser()
    expect(a.isSystem).toBe(false)
    expect(a.icsToken).toBeNull()
    await prisma.user.update({ where: { id: a.id }, data: { icsToken: 'tok-a' } })
    // A second non-null token collides only on equality.
    await expect(prisma.user.update({ where: { id: b.id }, data: { icsToken: 'tok-a' } })).rejects.toThrow()
    const issue = await prisma.issue.create({ data: { title: 't', creatorId: a.id, rank: 'V' } })
    expect(issue.dueSoonPingedAt).toBeNull()
  })

  it('seedSystem installs the isSystem bot + #lab-updates channel + bot membership', async () => {
    await seedSystem()
    const bot = await prisma.user.findUniqueOrThrow({ where: { id: COLOSSUS_BOT_ID } })
    expect(bot.isSystem).toBe(true)
    expect(bot.banned).toBe(false)
    const chan = await prisma.conversation.findUniqueOrThrow({ where: { id: LAB_UPDATES_CHANNEL_ID } })
    expect(chan.type).toBe('CHANNEL')
    expect(chan.isPrivate).toBe(false)
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: COLOSSUS_BOT_ID } },
    })
    expect(member).not.toBeNull()
    await seedSystem() // idempotent
  })
})
