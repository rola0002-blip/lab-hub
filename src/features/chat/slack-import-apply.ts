import { prisma } from '@/lib/db'
import type { ImportPlan } from './slack-import'

export type ApplyResult = {
  matched: number
  placeholders: number
  channels: number
  messages: number
  skipped: number
  // Plan-messages that could not be applied (e.g. an unresolvable conversation).
  // With ghost authors now rostered this is 0 in normal runs, but it is kept as
  // the reconciliation safety net: planTotal = messages + skipped + dropped.
  dropped: number
  reactions: number
}

// Applies an ImportPlan to the database. Idempotent: re-running with the same
// plan inserts nothing new (relies on the Conversation.slackChannelId,
// Message@@unique([conversationId, slackTs]) and Reaction unique constraints
// plus createMany skipDuplicates). Both the CLI and the integration test call it.
export async function applyImportPlan(plan: ImportPlan): Promise<ApplyResult> {
  // 1. Resolve slack users → LabHub user ids: match an existing user by
  //    lowercased email, otherwise create a banned guest placeholder.
  const userIdBySlack = new Map<string, string>()
  let matched = 0
  let placeholders = 0
  for (const u of plan.placeholderUsers) {
    const email = u.email.toLowerCase()
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      userIdBySlack.set(u.slackId, existing.id)
      matched++
    } else {
      const created = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          id: `slack-import-${u.slackId}`,
          name: u.name,
          email,
          emailVerified: false,
          role: 'guest',
          banned: true,
          banReason: 'Imported from Slack (placeholder account)',
        },
      })
      userIdBySlack.set(u.slackId, created.id)
      placeholders++
    }
  }
  const resolve = (slackId: string) => userIdBySlack.get(slackId)

  // 2. Upsert channels by slackChannelId; 3. create memberships (idempotent).
  const convoIdByChannel = new Map<string, string>()
  for (const c of plan.channels) {
    const createdById = c.memberSlackIds.map(resolve).find(Boolean) ?? 'slack-import'
    const convo = await prisma.conversation.upsert({
      where: { slackChannelId: c.slackChannelId },
      update: { name: c.name, topic: c.topic, isPrivate: c.isPrivate },
      create: {
        type: 'CHANNEL',
        name: c.name,
        topic: c.topic,
        isPrivate: c.isPrivate,
        slackChannelId: c.slackChannelId,
        createdById,
      },
    })
    convoIdByChannel.set(c.slackChannelId, convo.id)

    const memberIds = c.memberSlackIds.map(resolve).filter((id): id is string => !!id)
    if (memberIds.length) {
      await prisma.conversationMember.createMany({
        data: memberIds.map((userId) => ({ conversationId: convo.id, userId })),
        skipDuplicates: true,
      })
    }
  }

  // 4. Insert messages (first pass, no parentId). createMany skipDuplicates over
  //    the (conversationId, slackTs) unique = idempotency; count = new rows.
  const rows = plan.messages
    .map((m) => {
      const conversationId = convoIdByChannel.get(m.slackChannelId)
      const userId = resolve(m.authorSlackId)
      if (!conversationId || !userId) return null
      return {
        conversationId,
        userId,
        body: m.body,
        slackTs: m.slackTs,
        createdAt: new Date(m.createdAtMs),
        mentionUserIds: [],
        mentionsChannel: false,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const dropped = plan.messages.length - rows.length

  const inserted = rows.length
    ? await prisma.message.createMany({ data: rows, skipDuplicates: true })
    : { count: 0 }
  const messages = inserted.count
  const skipped = rows.length - inserted.count

  // Map (conversationId, slackTs) → message id for the second pass + reactions.
  const convoIds = [...convoIdByChannel.values()]
  const dbMsgs = await prisma.message.findMany({
    where: { conversationId: { in: convoIds }, slackTs: { not: null } },
    select: { id: true, conversationId: true, slackTs: true },
  })
  const idByKey = new Map(dbMsgs.map((m) => [`${m.conversationId}|${m.slackTs}`, m.id]))

  // 5. Second pass: link parentId per parent group via updateMany.
  const groups = new Map<string, { conversationId: string; parentTs: string; childTs: string[] }>()
  for (const m of plan.messages) {
    if (!m.threadParentTs) continue
    const conversationId = convoIdByChannel.get(m.slackChannelId)
    if (!conversationId) continue
    const key = `${conversationId}|${m.threadParentTs}`
    const g = groups.get(key) ?? { conversationId, parentTs: m.threadParentTs, childTs: [] }
    g.childTs.push(m.slackTs)
    groups.set(key, g)
  }
  for (const g of groups.values()) {
    const parentId = idByKey.get(`${g.conversationId}|${g.parentTs}`)
    if (!parentId) continue
    await prisma.message.updateMany({
      where: { conversationId: g.conversationId, slackTs: { in: g.childTs } },
      data: { parentId },
    })
  }

  // 6. Reactions (idempotent via unique + skipDuplicates).
  const reactionRows: { messageId: string; userId: string; emoji: string }[] = []
  for (const m of plan.messages) {
    if (m.reactions.length === 0) continue
    const conversationId = convoIdByChannel.get(m.slackChannelId)
    if (!conversationId) continue
    const messageId = idByKey.get(`${conversationId}|${m.slackTs}`)
    if (!messageId) continue
    for (const r of m.reactions) {
      for (const slackId of r.userSlackIds) {
        const userId = resolve(slackId)
        if (userId) reactionRows.push({ messageId, userId, emoji: r.emoji })
      }
    }
  }
  const reactions = reactionRows.length
    ? (await prisma.reaction.createMany({ data: reactionRows, skipDuplicates: true })).count
    : 0

  return { matched, placeholders, channels: plan.channels.length, messages, skipped, dropped, reactions }
}
