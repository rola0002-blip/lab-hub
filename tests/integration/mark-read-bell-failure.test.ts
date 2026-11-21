import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Wave 22: markRead's bell sync is best-effort — a failure must never fail the read
// itself. Its own file because the module mock below applies to the whole file.
vi.mock('@/lib/notification-read', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notification-read')>()),
  clearConversationBells: vi.fn().mockRejectedValue(new Error('bell sync down')),
}))

import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeDm } from '../factories'
import { _resetForTests } from '@/lib/events'
import { markRead } from '@/features/chat/message-service'

describe('markRead when the bell sync fails', () => {
  beforeEach(async () => { await resetDb() })
  afterEach(() => _resetForTests())

  it('still advances the read cursor, resolves, and logs the failure', async () => {
    const me = await makeUser()
    const peer = await makeUser()
    const dm = await makeDm([me.id, peer.id])
    const before = new Date('2026-01-01T00:00:00.000Z')
    await prisma.conversationMember.updateMany({ where: { conversationId: dm.id, userId: me.id }, data: { lastReadAt: before } })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(markRead({ userId: me.id, conversationId: dm.id })).resolves.toBeUndefined()
      const member = await prisma.conversationMember.findFirstOrThrow({ where: { conversationId: dm.id, userId: me.id } })
      expect(member.lastReadAt.getTime()).toBeGreaterThan(before.getTime())
      expect(logged).toHaveBeenCalledWith('clearConversationBells failed', expect.any(Error))
    } finally {
      logged.mockRestore()
    }
  })
})
