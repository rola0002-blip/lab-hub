import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { saveSubscription, deleteSubscription, sendPush } from '@/lib/push'

const SUB = { endpoint: 'https://push.example/ep1', keys: { p256dh: 'k1', auth: 'a1' } }

describe('web push', () => {
  beforeEach(resetDb)

  it('upserts by endpoint and moves a re-registered endpoint to the new user', async () => {
    const a = await makeUser()
    const b = await makeUser()
    await saveSubscription(a.id, SUB)
    await saveSubscription(a.id, SUB) // idempotent
    expect(await prisma.pushSubscription.count()).toBe(1)
    await saveSubscription(b.id, SUB) // browser re-registered under another account
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: SUB.endpoint } })
    expect(row.userId).toBe(b.id)
  })

  it('sendPush fans out to all subscriptions and prunes dead endpoints (410)', async () => {
    const u = await makeUser()
    await saveSubscription(u.id, SUB)
    await saveSubscription(u.id, { endpoint: 'https://push.example/ep2', keys: { p256dh: 'k2', auth: 'a2' } })
    const sender = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
      .mockResolvedValueOnce(undefined)
    await sendPush(u.id, { title: 't', body: 'b', url: '/chat/x' }, sender)
    expect(sender).toHaveBeenCalledTimes(2)
    expect(await prisma.pushSubscription.count()).toBe(1) // 410 endpoint pruned
    expect((await prisma.pushSubscription.findFirstOrThrow()).endpoint).toBe('https://push.example/ep2')
  })

  it('deleteSubscription removes only the owner’s row', async () => {
    const a = await makeUser()
    const b = await makeUser()
    await saveSubscription(a.id, SUB)
    await deleteSubscription(b.id, SUB.endpoint) // not b's
    expect(await prisma.pushSubscription.count()).toBe(1)
    await deleteSubscription(a.id, SUB.endpoint)
    expect(await prisma.pushSubscription.count()).toBe(0)
  })
})
