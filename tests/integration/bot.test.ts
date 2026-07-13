import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, seedSystem } from '../factories'
import { announceToChannel, dmUser, COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from '@/features/bot'

// sendMessage fires fanoutMessage as `void`, so the message_dm bell lands a few DB
// round-trips after the send resolves. Poll for it rather than assert synchronously.
const until = async (fn: () => Promise<boolean>, ms = 2000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)) }
}

describe('bot module', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('announceToChannel posts a kind:user message to #lab-updates that notifies no one', async () => {
    const human = await makeUser()
    await prisma.conversationMember.create({ data: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: human.id } })
    await announceToChannel('New issue COL-3: graphene transfer SOP')
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: LAB_UPDATES_CHANNEL_ID }, orderBy: { createdAt: 'desc' } })
    expect(msg.userId).toBe(COLOSSUS_BOT_ID)
    expect(msg.kind).toBe('user')
    expect(await prisma.notification.count({ where: { userId: human.id } })).toBe(0) // channel + no mention → no ping
  })

  it('dmUser opens/reuses a DM with the recipient; suppress=true DMs without a bell', async () => {
    const u = await makeUser()
    await dmUser(u.id, 'silent nudge', { suppress: true })
    const dm = await prisma.conversation.findFirstOrThrow({ where: { type: 'DM' } })
    expect(await prisma.message.count({ where: { conversationId: dm.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
    await dmUser(u.id, 'loud nudge') // normal → message_dm bell; reuses the same DM
    await until(async () => (await prisma.notification.count({ where: { userId: u.id, type: 'message_dm' } })) === 1)
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'message_dm' } })).toBe(1)
    expect(await prisma.conversation.count({ where: { type: 'DM' } })).toBe(1)
  })
})
