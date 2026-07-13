import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeDm } from '../factories'
import { sendMessage } from '@/features/chat/message-service'

// sendMessage fires fanoutMessage as `void` (fire-and-forget), so the message_dm
// bell lands a few DB round-trips AFTER the send resolves. Poll for it rather than
// assert synchronously (mirrors the `await wait(...)` idiom in notify.test.ts).
const until = async (fn: () => Promise<boolean>, ms = 2000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)) }
}

describe('suppressNotify (one-bell rule)', () => {
  beforeEach(resetDb)

  it('skips the notification + email but keeps the message row and unread count', async () => {
    const a = await makeUser(); const b = await makeUser()
    const dm = await makeDm([a.id, b.id])
    const r = await sendMessage({ userId: a.id, conversationId: dm.id, body: 'silent hello', suppressNotify: true })
    expect(r.ok).toBe(true)
    expect(await prisma.message.count({ where: { conversationId: dm.id } })).toBe(1) // row preserved
    expect(await prisma.notification.count({ where: { userId: b.id } })).toBe(0)    // no bell
    expect(await prisma.emailOutbox.count()).toBe(0)                                // no email
  })

  it('a NORMAL DM still notifies (control)', async () => {
    const a = await makeUser(); const b = await makeUser()
    const dm = await makeDm([a.id, b.id])
    await sendMessage({ userId: a.id, conversationId: dm.id, body: 'loud hello' })
    await until(async () => (await prisma.notification.count({ where: { userId: b.id, type: 'message_dm' } })) === 1)
    expect(await prisma.notification.count({ where: { userId: b.id, type: 'message_dm' } })).toBe(1)
  })
})
