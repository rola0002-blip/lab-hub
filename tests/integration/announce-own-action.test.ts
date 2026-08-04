import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, seedSystem } from '../factories'
import { announceToChannel, COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from '@/features/bot'
import { markReadUpTo } from '@/features/chat/message-service'
import { totalUnread } from '@/features/chat/conversation-service'

// Join a human to #lab-updates with a read cursor far enough back that any message
// written during the test counts as unread unless something advances it.
async function joinLabUpdates(userId: string, lastReadAt = new Date(Date.now() - 3_600_000)) {
  await prisma.conversationMember.create({ data: { conversationId: LAB_UPDATES_CHANNEL_ID, userId, lastReadAt } })
}
const cursor = async (userId: string) =>
  (await prisma.conversationMember.findUniqueOrThrow({
    where: { conversationId_userId: { conversationId: LAB_UPDATES_CHANNEL_ID, userId } },
    select: { lastReadAt: true },
  })).lastReadAt

describe('own-action exclusion (v0.11 §3.3)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('CAUGHT-UP branch: the actor’s cursor advances past their own announce, so it never counts against them', async () => {
    const actor = await makeUser()
    await joinLabUpdates(actor.id)
    expect(await totalUnread(actor.id)).toBe(0)          // caught up: the channel is empty

    await announceToChannel('New issue LAB-1: calibrate the SEM', actor.id)

    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: LAB_UPDATES_CHANNEL_ID }, orderBy: { createdAt: 'desc' } })
    expect(msg.userId).toBe(COLOSSUS_BOT_ID)             // still posted as the bot
    expect(await cursor(actor.id)).toEqual(msg.createdAt)
    expect(await totalUnread(actor.id)).toBe(0)          // their own action did not bump their badge
  })

  it('BEHIND branch: an unread third-party message leaves the cursor alone and the announce counts', async () => {
    const actor = await makeUser()
    const peer = await makeUser()
    await joinLabUpdates(actor.id)
    await joinLabUpdates(peer.id)
    await prisma.message.create({ data: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: peer.id, body: 'furnace is down' } })
    const before = await cursor(actor.id)
    expect(await totalUnread(actor.id)).toBe(1)

    await announceToChannel('New issue LAB-2: swap the seal', actor.id)

    expect(await cursor(actor.id)).toEqual(before)       // untouched — marking it read would hide the peer's message
    expect(await totalUnread(actor.id)).toBe(2)          // the peer's message AND the announce
  })

  it('the actor’s OWN earlier messages do not make them “behind”', async () => {
    const actor = await makeUser()
    await joinLabUpdates(actor.id)
    await prisma.message.create({ data: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: actor.id, body: 'note to self' } })

    await announceToChannel('New file: sop.pdf (in root) — uploaded by Actor', actor.id)

    expect(await totalUnread(actor.id)).toBe(0)
  })

  it('a non-member actor is a no-op (no write, no throw)', async () => {
    const outsider = await makeUser()
    await announceToChannel('New project: Graphene growth — /projects/x', outsider.id)
    expect(await prisma.conversationMember.count({ where: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: outsider.id } })).toBe(0)
    expect(await prisma.message.count({ where: { conversationId: LAB_UPDATES_CHANNEL_ID } })).toBe(1) // the announce still landed
  })

  it('omitting actorId leaves every cursor alone (the pre-v0.11 behaviour)', async () => {
    const a = await makeUser()
    await joinLabUpdates(a.id)
    const before = await cursor(a.id)
    await announceToChannel('LAB-3 done: transfer SOP')
    expect(await cursor(a.id)).toEqual(before)
    expect(await totalUnread(a.id)).toBe(1)
  })

  it('markReadUpTo is monotone and idempotent — it can only move a cursor forward', async () => {
    const u = await makeUser()
    const at = new Date()
    await joinLabUpdates(u.id, new Date(+at - 1000))
    expect(await markReadUpTo({ userId: u.id, conversationId: LAB_UPDATES_CHANNEL_ID, at })).toBe(true)
    expect(await cursor(u.id)).toEqual(at)
    // A second call at the same instant, and a call with an EARLIER instant, both no-op.
    expect(await markReadUpTo({ userId: u.id, conversationId: LAB_UPDATES_CHANNEL_ID, at })).toBe(false)
    expect(await markReadUpTo({ userId: u.id, conversationId: LAB_UPDATES_CHANNEL_ID, at: new Date(+at - 5000) })).toBe(false)
    expect(await cursor(u.id)).toEqual(at)
  })

  it('markReadUpTo matches zero rows for a non-member', async () => {
    const u = await makeUser()
    expect(await markReadUpTo({ userId: u.id, conversationId: LAB_UPDATES_CHANNEL_ID, at: new Date() })).toBe(false)
  })
})
