import { describe, it, expect, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, seedSystem } from '../factories'
import { dmUser, COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from '@/features/bot'
import { createIssue } from '@/features/issues/issue-service'
import { createDocument } from '@/features/documents/document-service'
import { fanoutMessage } from '@/features/chat/fanout'

// Wrap the REAL fanout in a spy (Task 8 idiom): the CALL is synchronous even though
// its notify writes land later, so awaiting the spy's returned promise is a settle
// barrier — a wrongly-created bell can't land AFTER we count zero rows.
vi.mock('@/features/chat/fanout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat/fanout')>()
  return { ...actual, fanoutMessage: vi.fn(actual.fanoutMessage) }
})
const fanoutSpy = vi.mocked(fanoutMessage)

const until = async (fn: () => Promise<boolean>, ms = 2000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)) }
}
const settleFanout = () => Promise.all(fanoutSpy.mock.results.map((r) => Promise.resolve(r.value).catch(() => {})))
const latestBotChannelMsg = () =>
  prisma.message.findFirst({ where: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: COLOSSUS_BOT_ID }, orderBy: { createdAt: 'desc' } })

// F1 — a member must not be able to weaponize the trusted, rate-limit-exempt bot by
// smuggling a mention token through user-controlled text the bot echoes verbatim.
describe('bot announce/DM mention-token injection (F1)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem(); fanoutSpy.mockClear() })

  it('an issue title carrying <!channel> announces with NO channel mention and pings nobody', async () => {
    const author = await makeUser({ role: 'member' })
    const bystander = await makeUser({ role: 'member' })
    // The whole org watches #lab-updates; register both explicitly.
    await prisma.conversationMember.createMany({ data: [
      { conversationId: LAB_UPDATES_CHANNEL_ID, userId: author.id },
      { conversationId: LAB_UPDATES_CHANNEL_ID, userId: bystander.id },
    ] })
    const i = await createIssue({ actorId: author.id, role: 'member', title: '<!channel> URGENT: sign in at evil.example' })
    await until(async () => { const m = await latestBotChannelMsg(); return !!m && m.body.includes(i.identifier) })
    await settleFanout()

    const msg = await latestBotChannelMsg()
    expect(msg?.mentionsChannel).toBe(false)          // token neutralized → not an @channel
    expect(msg?.mentionUserIds).toEqual([])
    expect(msg?.body).not.toContain('<!channel>')     // readable, non-token text survives
    // The workspace-wide bell blast the injection intended never fires (author + bystander).
    expect(await prisma.notification.count({ where: { userId: bystander.id } })).toBe(0)
    expect(await prisma.notification.count({ where: { userId: author.id } })).toBe(0)
  })

  it('a document name carrying <@id> announces with NO user mention and pings the target nobody', async () => {
    const uploader = await makeUser({ role: 'member' })
    const victim = await makeUser({ role: 'member' })
    await prisma.conversationMember.create({ data: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: victim.id } })
    const uuid = randomUUID().slice(0, 12)
    await createDocument({
      uploaderId: uploader.id, uploaderName: uploader.name,
      name: `<@${victim.id}> quarterly targets.pdf`,
      path: `/uploads/documents/${uuid}.pdf`, mime: 'application/pdf', size: 1024, folderId: null,
    })
    await until(async () => { const m = await latestBotChannelMsg(); return !!m && m.body.includes('quarterly targets') })
    await settleFanout()

    const msg = await latestBotChannelMsg()
    expect(msg?.mentionUserIds).toEqual([])           // a raw <@id> would resolve + notify (bypassing mute)
    expect(msg?.mentionsChannel).toBe(false)
    expect(await prisma.notification.count({ where: { userId: victim.id } })).toBe(0)
  })

  it('dmUser neutralizes tokens too — the bot never produces a mention in a DM', async () => {
    const u = await makeUser()
    await dmUser(u.id, `see <@${u.id}> and <!channel>`)
    const dm = await prisma.conversation.findFirstOrThrow({ where: { type: 'DM' } })
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: dm.id, userId: COLOSSUS_BOT_ID } })
    expect(msg.mentionUserIds).toEqual([])
    expect(msg.mentionsChannel).toBe(false)
    expect(msg.body).not.toContain(`<@${u.id}>`)
    expect(msg.body).not.toContain('<!channel>')
  })
})
