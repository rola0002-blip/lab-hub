import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeMember, seedSystem } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { GET as chatUsers } from '@/app/api/chat/users/route'
import { fanoutMessage } from '@/features/chat/fanout'
import { getOrCreateDm } from '@/features/chat/conversation-service'
import { humanUsers } from '@/features/chat/roster'
import { COLOSSUS_BOT_ID } from '@/features/bot'

describe('isSystem exclusions', () => {
  beforeEach(async () => { await resetDb(); await seedSystem(); mockUser.current = null })

  it('/api/chat/users includes the bot WITH an isSystem flag (for DM name resolution)', async () => {
    const u = await makeUser()
    mockUser.current = { id: u.id, name: u.name, email: u.email, role: u.role }
    const res = await chatUsers() // GET() takes no arguments
    const { users } = await res.json()
    // F2: the bot IS in the roster now (so a bot DM resolves to "LabHub Bot",
    // not "unknown") — carried with isSystem:true; humans carry isSystem:false.
    const bot = users.find((x: { id: string }) => x.id === COLOSSUS_BOT_ID)
    expect(bot?.isSystem).toBe(true)
    expect(users.find((x: { id: string }) => x.id === u.id)?.isSystem).toBe(false)
  })

  it('humanUsers keeps the bot OUT of the human-facing choosers', async () => {
    const u = await makeUser()
    mockUser.current = { id: u.id, name: u.name, email: u.email, role: u.role }
    const { users } = await (await chatUsers()).json()
    const chooser = humanUsers(users)
    expect(chooser.some((x: { id: string }) => x.id === COLOSSUS_BOT_ID)).toBe(false) // invisible in choosers
    expect(chooser.some((x: { id: string }) => x.id === u.id)).toBe(true)             // humans still listed
  })

  it('fan-out never targets the bot even when it is a channel member', async () => {
    const author = await makeUser()
    const chan = await makeChannel()
    await makeMember(chan.id, author.id)
    await makeMember(chan.id, COLOSSUS_BOT_ID)
    const m = await prisma.message.create({ data: { conversationId: chan.id, userId: author.id, body: 'hi @channel', mentionsChannel: true } })
    await fanoutMessage({ message: m, conversation: { ...chan } as never, senderName: author.name },
      { hasLive: () => true, push: async () => {} })
    expect(await prisma.notification.count({ where: { userId: COLOSSUS_BOT_ID } })).toBe(0)
  })

  it('getOrCreateDm still permits the bot as a participant', async () => {
    const u = await makeUser()
    const dm = await getOrCreateDm({ userIds: [COLOSSUS_BOT_ID, u.id], byId: COLOSSUS_BOT_ID })
    expect(dm.ok).toBe(true)
  })
})
