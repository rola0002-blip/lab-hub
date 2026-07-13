import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, seedSystem } from '../factories'
import { announceToChannel, dmUser, COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from '@/features/bot'
import { fanoutMessage } from '@/features/chat/fanout'

// fanoutMessage is fire-and-forget, so a BROKEN suppression guard would still read
// 0 rows at assertion time — bare `=== 0` counts alone are non-discriminating. Wrap
// the REAL fanout in a spy: the CALL is synchronous, so not-called is deterministic
// and the spy's returned promise doubles as a settle barrier for the channel case.
vi.mock('@/features/chat/fanout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat/fanout')>()
  return { ...actual, fanoutMessage: vi.fn(actual.fanoutMessage) }
})
const fanoutSpy = vi.mocked(fanoutMessage)

// The message_dm bell lands a few DB round-trips after the send resolves. Poll for
// it rather than assert synchronously.
const until = async (fn: () => Promise<boolean>, ms = 2000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)) }
}

describe('bot module', () => {
  beforeEach(async () => { await resetDb(); await seedSystem(); fanoutSpy.mockClear() })

  it('announceToChannel posts a kind:user message to #lab-updates that notifies no one', async () => {
    const human = await makeUser()
    await prisma.conversationMember.create({ data: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: human.id } })
    await announceToChannel('New issue COL-3: graphene transfer SOP')
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: LAB_UPDATES_CHANNEL_ID }, orderBy: { createdAt: 'desc' } })
    expect(msg.userId).toBe(COLOSSUS_BOT_ID)
    expect(msg.kind).toBe('user')
    // An announce is a NORMAL (unsuppressed) send, so fanout IS dispatched — it is
    // fanout's own channel/no-mention logic that pings no one. Await the spy's
    // returned promise so fanout has fully settled before asserting zero rows
    // (otherwise a wrongly-created bell could land after the assertion).
    expect(fanoutSpy).toHaveBeenCalledTimes(1)
    await fanoutSpy.mock.results[0].value
    expect(await prisma.notification.count({ where: { userId: human.id } })).toBe(0) // channel + no mention → no ping
  })

  it('dmUser opens/reuses a DM with the recipient; suppress=true DMs without a bell', async () => {
    const u = await makeUser()
    await dmUser(u.id, 'silent nudge', { suppress: true })
    // Discriminating check: a broken guard CALLS fanout synchronously (even though
    // its writes land later), so not-called fails deterministically on regression.
    expect(fanoutSpy).not.toHaveBeenCalled()
    const dm = await prisma.conversation.findFirstOrThrow({ where: { type: 'DM' } })
    expect(await prisma.message.count({ where: { conversationId: dm.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
    await dmUser(u.id, 'loud nudge') // normal → message_dm bell; reuses the same DM
    expect(fanoutSpy).toHaveBeenCalledTimes(1) // unsuppressed bot DM DOES dispatch fan-out
    await until(async () => (await prisma.notification.count({ where: { userId: u.id, type: 'message_dm' } })) === 1)
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'message_dm' } })).toBe(1)
    expect(await prisma.conversation.count({ where: { type: 'DM' } })).toBe(1)
  })
})
