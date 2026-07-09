import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { emitEvent } from '@/lib/events'

export type ConvResult = { ok: true; conversationId: string } | { ok: false; message: string }
export type ConversationListItem = {
  id: string; type: 'CHANNEL' | 'DM'; name: string | null; topic: string; isPrivate: boolean
  archived: boolean; muted: boolean; memberIds: string[]
  unread: number; mentions: number; lastMessageAt: string | null
}

async function activeNonGuest(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId } })
  return !!u && !u.banned && u.role !== 'guest'
}

export async function createChannel(args: { name: string; topic?: string; isPrivate: boolean; createdById: string }): Promise<ConvResult> {
  if (!(await activeNonGuest(args.createdById))) return { ok: false, message: 'Guests cannot create channels.' }
  const name = args.name.trim()
  if (name.length < 1 || name.length > 60) return { ok: false, message: 'Channel name must be 1–60 characters.' }
  const clash = await prisma.conversation.findFirst({
    where: { type: 'CHANNEL', archivedAt: null, name: { equals: name, mode: 'insensitive' } },
  })
  if (clash) return { ok: false, message: 'A channel with that name already exists.' }
  const convo = await prisma.conversation.create({
    data: {
      type: 'CHANNEL', name, topic: (args.topic ?? '').slice(0, 200), isPrivate: args.isPrivate,
      createdById: args.createdById,
      members: { create: { userId: args.createdById } },
    },
  })
  await emitEvent({ t: 'member', cid: convo.id, uid: args.createdById }) // creator's live list picks up the new channel
  return { ok: true, conversationId: convo.id }
}

export async function getOrCreateDm(args: { userIds: string[]; byId: string }): Promise<ConvResult> {
  const ids = [...new Set(args.userIds)]
  if (!ids.includes(args.byId)) return { ok: false, message: 'You must be part of the DM.' }
  if (ids.length < 2 || ids.length > 8) return { ok: false, message: 'DMs have 2–8 participants.' }
  const users = await prisma.user.findMany({ where: { id: { in: ids }, banned: false } })
  if (users.length !== ids.length) return { ok: false, message: 'All participants must be active users.' }
  const dmKey = [...ids].sort().join('|')
  const existing = await prisma.conversation.findUnique({ where: { dmKey } })
  if (existing) return { ok: true, conversationId: existing.id }
  try {
    const convo = await prisma.conversation.create({
      data: { type: 'DM', createdById: args.byId, dmKey, members: { create: ids.map((userId) => ({ userId })) } },
    })
    for (const userId of ids) await emitEvent({ t: 'member', cid: convo.id, uid: userId }) // only on CREATE; every participant's live list updates
    return { ok: true, conversationId: convo.id }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const raced = await prisma.conversation.findUnique({ where: { dmKey } })
      if (raced) return { ok: true, conversationId: raced.id } // concurrent creator won; that's fine
    }
    throw e
  }
}

export async function canManage(userId: string, conversationId: string): Promise<boolean> {
  const [user, convo] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.conversation.findUnique({ where: { id: conversationId } }),
  ])
  if (!user || user.banned || !convo || convo.type !== 'CHANNEL') return false
  return user.role === 'admin' || convo.createdById === userId
}

export async function addMembers(args: { conversationId: string; userIds: string[]; byId: string }): Promise<{ ok: boolean; message?: string }> {
  const convo = await prisma.conversation.findUnique({ where: { id: args.conversationId } })
  if (!convo || convo.type !== 'CHANNEL' || convo.archivedAt) return { ok: false, message: 'Channel not found.' }
  if (!(await canManage(args.byId, args.conversationId))) return { ok: false, message: 'Only admins or the channel creator manage members.' }
  const users = await prisma.user.findMany({ where: { id: { in: args.userIds }, banned: false }, select: { id: true } })
  const existing = new Set(
    (await prisma.conversationMember.findMany({ where: { conversationId: args.conversationId }, select: { userId: true } })).map((m) => m.userId),
  )
  const fresh = users.map((u) => u.id).filter((id) => !existing.has(id))
  await prisma.conversationMember.createMany({ data: fresh.map((userId) => ({ conversationId: args.conversationId, userId })) })
  for (const userId of fresh) await emitEvent({ t: 'member', cid: args.conversationId, uid: userId })
  return { ok: true }
}

export async function removeMember(args: { conversationId: string; userId: string; byId: string }): Promise<{ ok: boolean; message?: string }> {
  const selfLeave = args.userId === args.byId
  if (!selfLeave && !(await canManage(args.byId, args.conversationId))) {
    return { ok: false, message: 'Only admins or the channel creator remove members.' }
  }
  const { count } = await prisma.conversationMember.deleteMany({ where: { conversationId: args.conversationId, userId: args.userId } })
  if (count === 0) return { ok: false, message: 'Not a member.' }
  await emitEvent({ t: 'member', cid: args.conversationId, uid: args.userId })
  return { ok: true }
}

export async function joinPublicChannel(args: { conversationId: string; userId: string }): Promise<{ ok: boolean; message?: string }> {
  if (!(await activeNonGuest(args.userId))) return { ok: false, message: 'Guests join channels by invitation only.' }
  const convo = await prisma.conversation.findUnique({ where: { id: args.conversationId } })
  if (!convo || convo.type !== 'CHANNEL' || convo.isPrivate || convo.archivedAt) return { ok: false, message: 'Channel is not joinable.' }
  await prisma.conversationMember.upsert({
    where: { conversationId_userId: { conversationId: args.conversationId, userId: args.userId } },
    update: {}, create: { conversationId: args.conversationId, userId: args.userId },
  })
  await emitEvent({ t: 'member', cid: args.conversationId, uid: args.userId })
  return { ok: true }
}

export type ManageResult = { ok: true } | { ok: false; error: 'forbidden' | 'invalid'; message: string }

export async function renameChannel(args: { conversationId: string; name: string; byId: string }): Promise<ManageResult> {
  const convo = await prisma.conversation.findUnique({ where: { id: args.conversationId } })
  if (!convo || convo.type !== 'CHANNEL' || convo.archivedAt) return { ok: false, error: 'forbidden', message: 'Channel not found.' }
  if (!(await canManage(args.byId, args.conversationId))) return { ok: false, error: 'forbidden', message: 'Only admins or the channel creator rename channels.' }
  const name = args.name.trim()
  if (name.length < 1 || name.length > 60) return { ok: false, error: 'invalid', message: 'Channel name must be 1–60 characters.' }
  const clash = await prisma.conversation.findFirst({
    where: { type: 'CHANNEL', archivedAt: null, name: { equals: name, mode: 'insensitive' }, id: { not: args.conversationId } },
  })
  if (clash) return { ok: false, error: 'invalid', message: 'A channel with that name already exists.' }
  await prisma.conversation.update({ where: { id: args.conversationId }, data: { name } })
  return { ok: true }
}

export async function setChannelTopic(args: { conversationId: string; topic: string; byId: string }): Promise<ManageResult> {
  const convo = await prisma.conversation.findUnique({ where: { id: args.conversationId } })
  if (!convo || convo.type !== 'CHANNEL' || convo.archivedAt) return { ok: false, error: 'forbidden', message: 'Channel not found.' }
  if (!(await canManage(args.byId, args.conversationId))) return { ok: false, error: 'forbidden', message: 'Only admins or the channel creator set the topic.' }
  await prisma.conversation.update({ where: { id: args.conversationId }, data: { topic: args.topic.trim().slice(0, 200) } })
  return { ok: true }
}

export async function archiveChannel(args: { conversationId: string; byId: string }): Promise<{ ok: boolean; message?: string }> {
  if (!(await canManage(args.byId, args.conversationId))) return { ok: false, message: 'Only admins or the channel creator archive channels.' }
  await prisma.conversation.update({ where: { id: args.conversationId }, data: { archivedAt: new Date() } })
  return { ok: true }
}

export async function setMuted(args: { conversationId: string; userId: string; muted: boolean }): Promise<{ ok: boolean }> {
  await prisma.conversationMember.updateMany({
    where: { conversationId: args.conversationId, userId: args.userId }, data: { muted: args.muted },
  })
  return { ok: true }
}

export async function isMember(userId: string, conversationId: string): Promise<boolean> {
  return !!(await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  }))
}

export async function accessibleConversationIds(userId: string): Promise<string[]> {
  const rows = await prisma.conversationMember.findMany({ where: { userId }, select: { conversationId: true } })
  return rows.map((r) => r.conversationId)
}

export async function listConversations(userId: string): Promise<ConversationListItem[]> {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId },
    include: { conversation: { include: { members: { select: { userId: true } } } } },
  })
  const items = await Promise.all(
    memberships.map(async (m) => {
      const base = { conversationId: m.conversationId, deletedAt: null, userId: { not: userId }, createdAt: { gt: m.lastReadAt } }
      const [unread, mentions, last] = await Promise.all([
        prisma.message.count({ where: base }),
        prisma.message.count({ where: { ...base, OR: [{ mentionUserIds: { has: userId } }, { mentionsChannel: true }] } }),
        prisma.message.findFirst({ where: { conversationId: m.conversationId, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ])
      return {
        id: m.conversationId, type: m.conversation.type, name: m.conversation.name, topic: m.conversation.topic,
        isPrivate: m.conversation.isPrivate, archived: !!m.conversation.archivedAt, muted: m.muted,
        memberIds: m.conversation.members.map((x) => x.userId),
        unread, mentions, lastMessageAt: last?.createdAt.toISOString() ?? null,
      }
    }),
  )
  return items.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
}

export async function totalUnread(userId: string): Promise<number> {
  const memberships = await prisma.conversationMember.findMany({
    where: { userId }, select: { conversationId: true, lastReadAt: true },
  })
  if (memberships.length === 0) return 0
  const counts = await Promise.all(
    memberships.map((m) =>
      prisma.message.count({
        where: { conversationId: m.conversationId, deletedAt: null, userId: { not: userId }, createdAt: { gt: m.lastReadAt } },
      }),
    ),
  )
  return counts.reduce((a, b) => a + b, 0)
}

export async function listPublicChannels(userId: string) {
  if (!(await activeNonGuest(userId))) return []
  const channels = await prisma.conversation.findMany({
    where: { type: 'CHANNEL', isPrivate: false, archivedAt: null },
    include: { members: { select: { userId: true } } },
    orderBy: { name: 'asc' },
  })
  return channels.map((c) => ({
    id: c.id, name: c.name, topic: c.topic, memberCount: c.members.length,
    isMember: c.members.some((m) => m.userId === userId),
  }))
}
