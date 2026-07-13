import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeDm } from '../factories'
import { sendMessage } from '@/features/chat/message-service'
import { fanoutMessage } from '@/features/chat/fanout'

// fanoutMessage is fire-and-forget (`void fanoutMessage(...)`), so a BROKEN
// suppression guard would still read 0 rows at assertion time (its writes land
// later) — bare `=== 0` counts alone are non-discriminating. Wrap the REAL fanout
// in a spy: the CALL is synchronous even though its work is async, so a not-called
// assertion is deterministic and mutation-killing. Controls still run the real
// implementation (the spy delegates), so the row assertions stay behavioral.
vi.mock('@/features/chat/fanout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat/fanout')>()
  return { ...actual, fanoutMessage: vi.fn(actual.fanoutMessage) }
})
const fanoutSpy = vi.mocked(fanoutMessage)

// The bell lands a few DB round-trips AFTER the send resolves. Poll for it rather
// than assert synchronously (mirrors the `await wait(...)` idiom in notify.test.ts).
const until = async (fn: () => Promise<boolean>, ms = 2000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)) }
}

describe('suppressNotify (one-bell rule)', () => {
  beforeEach(async () => { await resetDb(); fanoutSpy.mockClear() })

  it('skips the notification + email but keeps the message row and unread count', async () => {
    const a = await makeUser(); const b = await makeUser()
    const dm = await makeDm([a.id, b.id])
    const r = await sendMessage({ userId: a.id, conversationId: dm.id, body: 'silent hello', suppressNotify: true })
    expect(r.ok).toBe(true)
    // Discriminating check: a broken guard CALLS fanout synchronously (even though
    // its writes land later), so not-called fails deterministically on regression.
    expect(fanoutSpy).not.toHaveBeenCalled()
    expect(await prisma.message.count({ where: { conversationId: dm.id } })).toBe(1) // row preserved
    expect(await prisma.notification.count({ where: { userId: b.id } })).toBe(0)    // no bell
    expect(await prisma.emailOutbox.count()).toBe(0)                                // no email
  })

  it('a NORMAL DM still notifies (control)', async () => {
    const a = await makeUser(); const b = await makeUser()
    const dm = await makeDm([a.id, b.id])
    await sendMessage({ userId: a.id, conversationId: dm.id, body: 'loud hello' })
    expect(fanoutSpy).toHaveBeenCalledTimes(1) // unsuppressed send DOES dispatch fan-out
    await until(async () => (await prisma.notification.count({ where: { userId: b.id, type: 'message_dm' } })) === 1)
    expect(await prisma.notification.count({ where: { userId: b.id, type: 'message_dm' } })).toBe(1)
  })
})
