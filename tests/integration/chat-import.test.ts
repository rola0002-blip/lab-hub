import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { resetDb } from '../factories'
import { buildImportPlan, type SlackUser, type SlackChannel, type SlackMsg } from '@/features/chat/slack-import'
import { applyImportPlan } from '@/features/chat/slack-import-apply'

const FIXTURE = path.resolve(__dirname, '../fixtures/slack-export')

function readFixture() {
  const users = JSON.parse(readFileSync(path.join(FIXTURE, 'users.json'), 'utf8')) as SlackUser[]
  const channels = JSON.parse(readFileSync(path.join(FIXTURE, 'channels.json'), 'utf8')) as SlackChannel[]
  const messagesByChannel: Record<string, SlackMsg[]> = {}
  for (const ch of channels) {
    const dir = path.join(FIXTURE, ch.name)
    const msgs: SlackMsg[] = []
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
      msgs.push(...(JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as SlackMsg[]))
    }
    messagesByChannel[ch.id] = msgs
  }
  return { users, channels, messagesByChannel }
}

describe('applyImportPlan (Slack import)', () => {
  beforeEach(resetDb)

  it('attributes matched users, creates banned placeholders, links threads, and is idempotent', async () => {
    // A real LabHub user shares U1's slack email → U1's messages attach to them.
    const pi = await prisma.user.create({
      data: { id: 'pi-real', name: 'Roland', email: 'pi@lab.test', emailVerified: true, role: 'member' },
    })

    const plan = buildImportPlan(readFixture())
    const result = await applyImportPlan(plan)

    expect(result).toMatchObject({ matched: 1, placeholders: 2, channels: 2, messages: 5, skipped: 0 })
    expect(result.reactions).toBe(1)

    // Matched user's messages (2 in general + 1 in secret) attach to the real account.
    const piMsgs = await prisma.message.findMany({ where: { userId: pi.id } })
    expect(piMsgs).toHaveLength(3)

    // Placeholders created banned as guests.
    const alumni = await prisma.user.findUnique({ where: { email: 'left@lab.test' } })
    const visitor = await prisma.user.findUnique({ where: { email: 'slack-u3@import.invalid' } })
    expect(alumni).toMatchObject({ banned: true, role: 'guest', emailVerified: false })
    expect(visitor).toMatchObject({ banned: true, role: 'guest' })

    // Channel membership: general has all three; secret is private with only the matched member.
    const general = await prisma.conversation.findUnique({
      where: { slackChannelId: 'C1' },
      include: { members: true },
    })
    const secret = await prisma.conversation.findUnique({
      where: { slackChannelId: 'C2' },
      include: { members: true },
    })
    expect(general!.members).toHaveLength(3)
    expect(secret!.isPrivate).toBe(true)
    expect(secret!.members).toHaveLength(1)
    expect(secret!.members[0].userId).toBe(pi.id)

    // Thread parentId linkage: the reply points at the thread-root message.
    const root = await prisma.message.findUnique({
      where: { conversationId_slackTs: { conversationId: general!.id, slackTs: '1705300100.000200' } },
    })
    const reply = await prisma.message.findUnique({
      where: { conversationId_slackTs: { conversationId: general!.id, slackTs: '1705300200.000300' } },
    })
    expect(reply!.parentId).toBe(root!.id)

    // The reaction landed on the reply, attributed to the placeholder for U2.
    const reactions = await prisma.reaction.findMany({ where: { messageId: reply!.id } })
    expect(reactions).toHaveLength(1)
    expect(reactions[0]).toMatchObject({ emoji: '👍', userId: alumni!.id })

    // Idempotency: a second apply of the identical plan inserts zero new messages.
    const rerun = await applyImportPlan(plan)
    expect(rerun.messages).toBe(0)
    expect(rerun.skipped).toBe(5)
    expect(await prisma.message.count()).toBe(5)
    expect(await prisma.reaction.count()).toBe(1)
  })
})
