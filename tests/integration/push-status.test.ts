import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { saveSubscription } from '@/lib/push'
import { listPushStatus } from '@/features/admin/push-status'

describe('listPushStatus', () => {
  beforeEach(resetDb)

  it('lists human members with their push-enabled state, name-ordered, bot excluded', async () => {
    const zed = await makeUser({ name: 'Zed' })
    await makeUser({ name: 'Ada' })
    await makeUser({ name: 'Quiet' })
    await prisma.user.create({ data: { id: 'bot-status', name: 'LabHub Bot', email: 'bot@test.local', emailVerified: true, isSystem: true } })
    await saveSubscription(zed.id, { endpoint: 'https://push.example/z1', keys: { p256dh: 'k', auth: 'a' } })

    const rows = await listPushStatus()
    expect(rows.map((r) => r.name)).toEqual(['Ada', 'Quiet', 'Zed']) // alphabetical, no bot
    expect(rows.find((r) => r.name === 'Zed')?.pushEnabled).toBe(true)
    expect(rows.find((r) => r.name === 'Ada')?.pushEnabled).toBe(false)
  })
})
