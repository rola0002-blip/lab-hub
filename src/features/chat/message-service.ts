import 'server-only'
import type { Prisma as P } from '@prisma/client'
import { prisma } from '@/lib/db'
import { emitEvent } from '@/lib/events'
import { removeUpload } from '@/lib/uploads'
import { isMember } from './conversation-service'
import { parseMentions } from './mentions'
import { checkRate } from './rate-limit'
import { fanoutMessage } from './fanout'

export type MessageDto = {
  id: string; conversationId: string; parentId: string | null
  author: { id: string; name: string; image: string | null }
  body: string; deleted: boolean; editedAt: string | null; createdAt: string
  replyCount: number
  reactions: { emoji: string; userIds: string[] }[]
  attachments: { id: string; path: string; name: string; mime: string; size: number }[]
  mentionUserIds: string[]; mentionsChannel: boolean
}
export type SendInput = {
  userId: string; conversationId: string; body: string; parentId?: string
  attachments?: { path: string; name: string; mime: string; size: number }[]
}
export type SendResult = { ok: true; message: MessageDto } | { ok: false; error: 'forbidden' | 'rate_limited' | 'invalid'; message: string }

const MSG_INCLUDE = {
  user: { select: { id: true, name: true, image: true } },
  reactions: true,
  attachments: true,
  _count: { select: { replies: true } },
} satisfies P.MessageInclude

type Loaded = P.MessageGetPayload<{ include: typeof MSG_INCLUDE }>

function toDto(m: Loaded): MessageDto {
  const grouped = new Map<string, string[]>()
  for (const r of m.reactions) grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), r.userId])
  return {
    id: m.id, conversationId: m.conversationId, parentId: m.parentId,
    author: { id: m.user.id, name: m.user.name, image: m.user.image },
    body: m.deletedAt ? '' : m.body, deleted: !!m.deletedAt,
    editedAt: m.editedAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString(),
    replyCount: m._count.replies,
    reactions: [...grouped.entries()].map(([emoji, userIds]) => ({ emoji, userIds })),
    attachments: m.attachments.map((a) => ({ id: a.id, path: a.path, name: a.name, mime: a.mime, size: a.size })),
    mentionUserIds: m.mentionUserIds, mentionsChannel: m.mentionsChannel,
  }
}

async function resolveMentions(body: string, conversationId: string, senderId: string, senderRole: string) {
  const parsed = parseMentions(body)
  const members = new Set(
    (await prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } })).map((m) => m.userId),
  )
  return {
    mentionUserIds: parsed.userIds.filter((id) => members.has(id) && id !== senderId),
    mentionsChannel: parsed.channel && senderRole !== 'guest',
  }
}

export async function sendMessage(input: SendInput): Promise<SendResult> {
  const [member, convo, sender] = await Promise.all([
    isMember(input.userId, input.conversationId),
    prisma.conversation.findUnique({ where: { id: input.conversationId } }),
    prisma.user.findUnique({ where: { id: input.userId } }),
  ])
  if (!member || !convo || !sender) return { ok: false, error: 'forbidden', message: 'You are not a member of this conversation.' }
  if (convo.archivedAt) return { ok: false, error: 'invalid', message: 'This conversation is archived.' }
  const body = input.body.trim().slice(0, 4000)
  if (!body && !(input.attachments?.length)) return { ok: false, error: 'invalid', message: 'Message is empty.' }
  if (input.parentId) {
    const root = await prisma.message.findUnique({ where: { id: input.parentId } })
    if (!root || root.conversationId !== input.conversationId || root.parentId !== null || root.deletedAt) {
      return { ok: false, error: 'invalid', message: 'Thread replies attach to a message in this conversation.' }
    }
  }
  if (!checkRate(input.userId)) return { ok: false, error: 'rate_limited', message: 'Slow down — limit is 30 messages per minute.' }

  const { mentionUserIds, mentionsChannel } = await resolveMentions(body, input.conversationId, input.userId, sender.role)
  const created = await prisma.message.create({
    data: {
      conversationId: input.conversationId, userId: input.userId, body,
      parentId: input.parentId ?? null, mentionUserIds, mentionsChannel,
      attachments: { create: (input.attachments ?? []).map((a) => ({ path: a.path, name: a.name.slice(0, 200), mime: a.mime, size: a.size })) },
    },
    include: MSG_INCLUDE,
  })
  await emitEvent({ t: 'msg', cid: input.conversationId, mid: created.id })
  void fanoutMessage({ message: created, conversation: convo, senderName: sender.name })
  return { ok: true, message: toDto(created) }
}

export async function editMessage(args: { messageId: string; userId: string; body: string }): Promise<{ ok: boolean; message?: string }> {
  const [msg, user] = await Promise.all([
    prisma.message.findUnique({ where: { id: args.messageId } }),
    prisma.user.findUnique({ where: { id: args.userId } }),
  ])
  if (!msg || msg.deletedAt || !user) return { ok: false, message: 'Message not found.' }
  if (msg.userId !== args.userId) return { ok: false, message: 'You can only edit your own messages.' }
  const body = args.body.trim().slice(0, 4000)
  if (!body) return { ok: false, message: 'Message cannot be empty.' }
  const { mentionUserIds, mentionsChannel } = await resolveMentions(body, msg.conversationId, args.userId, user.role)
  await prisma.message.update({ where: { id: msg.id }, data: { body, editedAt: new Date(), mentionUserIds, mentionsChannel } })
  await emitEvent({ t: 'msg_edit', cid: msg.conversationId, mid: msg.id })
  return { ok: true }
}

export async function deleteMessage(args: { messageId: string; userId: string }): Promise<{ ok: boolean; message?: string }> {
  const [msg, user] = await Promise.all([
    prisma.message.findUnique({ where: { id: args.messageId } }),
    prisma.user.findUnique({ where: { id: args.userId } }),
  ])
  if (!msg || msg.deletedAt || !user) return { ok: false, message: 'Message not found.' }
  if (msg.userId !== args.userId && user.role !== 'admin') return { ok: false, message: 'You can only delete your own messages.' }
  // The message row stays as a tombstone, but its attachments must be revoked:
  // drop the ChatAttachment rows and unlink the on-disk files. Otherwise the
  // capability URL every member already holds keeps serving the "deleted" file
  // and the uploads dir grows without bound.
  const attachments = await prisma.chatAttachment.findMany({ where: { messageId: msg.id }, select: { path: true } })
  await prisma.message.update({
    where: { id: msg.id },
    data: { deletedAt: new Date(), body: '', mentionUserIds: [], mentionsChannel: false },
  })
  await prisma.chatAttachment.deleteMany({ where: { messageId: msg.id } })
  await Promise.all(attachments.map((a) => removeUpload(a.path).catch(() => {}))) // file removal is best-effort
  await emitEvent({ t: 'msg_del', cid: msg.conversationId, mid: msg.id })
  return { ok: true }
}

export async function toggleReaction(args: { messageId: string; userId: string; emoji: string }): Promise<{ ok: boolean; message?: string }> {
  const msg = await prisma.message.findUnique({ where: { id: args.messageId } })
  if (!msg || msg.deletedAt) return { ok: false, message: 'Message not found.' }
  if (!(await isMember(args.userId, msg.conversationId))) return { ok: false, message: 'Members only.' }
  const emoji = args.emoji.trim()
  if (!emoji || emoji.length > 16) return { ok: false, message: 'Invalid emoji.' }
  const existing = await prisma.reaction.findUnique({
    where: { messageId_userId_emoji: { messageId: msg.id, userId: args.userId, emoji } },
  })
  if (existing) await prisma.reaction.delete({ where: { id: existing.id } })
  else await prisma.reaction.create({ data: { messageId: msg.id, userId: args.userId, emoji } })
  await emitEvent({ t: 'rx', cid: msg.conversationId, mid: msg.id })
  return { ok: true }
}

export async function listMessages(args: { userId: string; conversationId: string; before?: string; take?: number }):
  Promise<{ ok: false } | { ok: true; messages: MessageDto[]; hasMore: boolean; firstUnreadId: string | null }> {
  // Fetch the caller's membership row directly (rather than isMember): it both
  // gates access AND carries lastReadAt, which anchors the "New messages" line.
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: args.conversationId, userId: args.userId } },
    select: { lastReadAt: true },
  })
  if (!member) return { ok: false }
  const take = Math.min(args.take ?? 50, 100)
  const cursor = args.before ? await prisma.message.findUnique({ where: { id: args.before } }) : null
  const [rows, firstUnread] = await Promise.all([
    prisma.message.findMany({
      where: {
        conversationId: args.conversationId, parentId: null,
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: MSG_INCLUDE,
    }),
    // Oldest root message the reader hasn't seen yet (createdAt strictly after
    // their lastReadAt). Conversation-wide, independent of the page cursor.
    prisma.message.findFirst({
      where: { conversationId: args.conversationId, parentId: null, createdAt: { gt: member.lastReadAt } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    }),
  ])
  const hasMore = rows.length > take
  return { ok: true, messages: rows.slice(0, take).reverse().map(toDto), hasMore, firstUnreadId: firstUnread?.id ?? null }
}

export async function listThread(args: { userId: string; rootId: string }):
  Promise<{ ok: false } | { ok: true; root: MessageDto; replies: MessageDto[] }> {
  const root = await prisma.message.findUnique({ where: { id: args.rootId }, include: MSG_INCLUDE })
  if (!root || root.parentId !== null) return { ok: false }
  if (!(await isMember(args.userId, root.conversationId))) return { ok: false }
  const replies = await prisma.message.findMany({
    where: { parentId: root.id }, orderBy: { createdAt: 'asc' }, include: MSG_INCLUDE,
  })
  return { ok: true, root: toDto(root), replies: replies.map(toDto) }
}

export async function getMessageDto(messageId: string): Promise<MessageDto | null> {
  const m = await prisma.message.findUnique({ where: { id: messageId }, include: MSG_INCLUDE })
  return m ? toDto(m) : null
}

export async function markRead(args: { userId: string; conversationId: string }): Promise<void> {
  await prisma.conversationMember.updateMany({
    where: { conversationId: args.conversationId, userId: args.userId }, data: { lastReadAt: new Date() },
  })
  await emitEvent({ t: 'read', cid: args.conversationId, uid: args.userId })
}
