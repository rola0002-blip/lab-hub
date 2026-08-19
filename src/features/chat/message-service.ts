import 'server-only'
import type { Prisma as P, Message } from '@prisma/client'
import { prisma } from '@/lib/db'
import { emitEvent } from '@/lib/events'
import { removeUpload } from '@/lib/uploads'
import { isMember } from './conversation-service'
import { parseMentions } from './mentions'
import { checkRate } from './rate-limit'
import { fanoutMessage, fanoutThreadReply } from './fanout'

export type MessageDto = {
  id: string; conversationId: string; parentId: string | null
  // 'user' = a person's message; 'system' = an event line (created/joined/…) that
  // renders centered/muted and never counts as unread or notifies.
  kind: 'user' | 'system'
  author: { id: string; name: string; image: string | null }
  body: string; deleted: boolean; editedAt: string | null; createdAt: string
  // W4-A1: set when pinned (members/admins only), null = unpinned. Drives the
  // toolbar Pin active state and the header "Pinned (n)" popover list.
  pinnedAt: string | null
  replyCount: number
  // Thread facepile (root messages only): the distinct authors of replies, newest
  // first and capped at 5, plus the time of the most recent reply. Replies carry
  // an empty list / null lastReplyAt (single-level threads have no grandchildren).
  replyParticipants: { id: string; name: string; image: string | null }[]
  lastReplyAt: string | null
  reactions: { emoji: string; userIds: string[] }[]
  attachments: { id: string; path: string; name: string; mime: string; size: number }[]
  mentionUserIds: string[]; mentionsChannel: boolean
}
export type SendInput = {
  userId: string; conversationId: string; body: string; parentId?: string
  // "Also send to #channel": a thread reply with broadcast=true additionally posts
  // a root-level copy into the channel timeline (a thread_broadcast-style copy),
  // so members not watching the thread still see it. No schema change — the copy
  // is just another root Message.
  broadcast?: boolean
  attachments?: { path: string; name: string; mime: string; size: number }[]
  // Internal-only (bot module). When true, sendMessage SKIPS fanoutMessage (bell +
  // offline email + Web Push) and nothing else — the Message row, the emitEvent
  // 'msg' SSE event and unread counting are preserved. NEVER settable over HTTP:
  // the /api/chat/messages zod schema has no such field (zod strips unknown keys).
  suppressNotify?: boolean
}
export type SendResult = { ok: true; message: MessageDto } | { ok: false; error: 'forbidden' | 'rate_limited' | 'invalid'; message: string }

const MSG_INCLUDE = {
  user: { select: { id: true, name: true, image: true } },
  reactions: true,
  attachments: true,
  _count: { select: { replies: true } },
  // Slim reply projection (author + time only), newest first, so a root DTO can
  // build its facepile. Threads are single-level, so on a reply this relation is
  // always empty — the extra include is a no-op there.
  replies: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { createdAt: true, user: { select: { id: true, name: true, image: true } } },
  },
} satisfies P.MessageInclude

type Loaded = P.MessageGetPayload<{ include: typeof MSG_INCLUDE }>

function toDto(m: Loaded): MessageDto {
  const grouped = new Map<string, string[]>()
  for (const r of m.reactions) grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), r.userId])
  // Distinct reply authors, newest-first (m.replies is ordered createdAt desc),
  // capped at 5 for the facepile. lastReplyAt is the most recent reply's time.
  const seen = new Set<string>()
  const replyParticipants: MessageDto['replyParticipants'] = []
  for (const rep of m.replies) {
    if (seen.has(rep.user.id)) continue
    seen.add(rep.user.id)
    replyParticipants.push({ id: rep.user.id, name: rep.user.name, image: rep.user.image })
    if (replyParticipants.length === 5) break
  }
  return {
    id: m.id, conversationId: m.conversationId, parentId: m.parentId,
    kind: m.kind === 'system' ? 'system' : 'user',
    author: { id: m.user.id, name: m.user.name, image: m.user.image },
    body: m.deletedAt ? '' : m.body, deleted: !!m.deletedAt,
    editedAt: m.editedAt?.toISOString() ?? null, createdAt: m.createdAt.toISOString(),
    pinnedAt: m.pinnedAt?.toISOString() ?? null,
    replyCount: m._count.replies,
    replyParticipants,
    lastReplyAt: m.replies.length > 0 ? m.replies[0].createdAt.toISOString() : null,
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
  // Captured at validation so the fanout hook below reuses it (no second findUnique).
  let rootMsg: Message | null = null
  if (input.parentId) {
    rootMsg = await prisma.message.findUnique({ where: { id: input.parentId } })
    if (!rootMsg || rootMsg.conversationId !== input.conversationId || rootMsg.parentId !== null || rootMsg.deletedAt) {
      return { ok: false, error: 'invalid', message: 'Thread replies attach to a message in this conversation.' }
    }
  }
  // The bot (isSystem) may burst — many managers to DM, bulk issue creation — so it
  // is exempt from the 30/min limiter. Safe: no human is isSystem and the HTTP route
  // cannot forge one (it always passes the session user's id).
  if (!sender.isSystem && !checkRate(input.userId)) return { ok: false, error: 'rate_limited', message: 'Slow down — limit is 30 messages per minute.' }

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
  if (!input.suppressNotify) void fanoutMessage({ message: created, conversation: convo, senderName: sender.name })

  // F8: a thread reply bells the thread's participants (suppressed bot DMs
  // and broadcast copies excluded — the copy fans out on its own above/below).
  if (input.parentId && !input.suppressNotify) {
    // rootMsg is non-null and in this conversation — validated at the top of sendMessage
    if (rootMsg) void fanoutThreadReply({ reply: created, root: rootMsg, conversation: convo, senderName: sender.name })
  }

  // "Also send to #channel": mirror a thread reply into the channel as its own
  // root message so members not watching the thread still see it. Purely additive
  // (no schema change) — the copy is an ordinary root that fans out like any send.
  if (input.parentId && input.broadcast && body) {
    const copy = await prisma.message.create({
      data: {
        conversationId: input.conversationId, userId: input.userId, body,
        parentId: null, mentionUserIds, mentionsChannel,
      },
      include: MSG_INCLUDE,
    })
    await emitEvent({ t: 'msg', cid: input.conversationId, mid: copy.id })
    if (!input.suppressNotify) void fanoutMessage({ message: copy, conversation: convo, senderName: sender.name })
  }
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

// ── pinning (W4-A1: members+admins pin; guests view-only; header popover) ────
export type PinResult = { ok: true; message: MessageDto } | { ok: false; error: 'forbidden' | 'invalid'; message: string }

export async function setPinned(args: { messageId: string; userId: string; role: string; pinned: boolean }): Promise<PinResult> {
  const msg = await prisma.message.findUnique({ where: { id: args.messageId } })
  // Missing message and non-member raise the SAME shape (no existence leak).
  if (!msg || !(await isMember(args.userId, msg.conversationId))) return { ok: false, error: 'forbidden', message: 'Message not found.' }
  if (args.role === 'guest') return { ok: false, error: 'forbidden', message: 'Guests cannot pin messages.' }
  if (msg.deletedAt && args.pinned) return { ok: false, error: 'invalid', message: 'Deleted messages cannot be pinned.' }
  if (msg.deletedAt && !args.pinned) return { ok: true, message: (await getMessageDto(msg.id))! } // unpin on a tombstone: no-op success
  const updated = await prisma.message.update({ where: { id: msg.id }, data: { pinnedAt: args.pinned ? new Date() : null }, include: MSG_INCLUDE })
  // Reuse the EXISTING msg_edit event — other tabs refetch the message (and the
  // pane refetches the pinned list); no new SSE member.
  await emitEvent({ t: 'msg_edit', cid: msg.conversationId, mid: msg.id })
  return { ok: true, message: toDto(updated) }
}

export async function listPinned(args: { conversationId: string; userId: string }): Promise<MessageDto[] | null> {
  if (!(await isMember(args.userId, args.conversationId))) return null
  const rows = await prisma.message.findMany({
    where: { conversationId: args.conversationId, pinnedAt: { not: null }, deletedAt: null },
    orderBy: { pinnedAt: 'desc' }, include: MSG_INCLUDE,
  })
  return rows.map(toDto)
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
    // Oldest root USER message the reader hasn't seen yet (createdAt strictly
    // after their lastReadAt). System rows (created/joined lines) never anchor the
    // New-messages line, and neither do the reader's OWN messages — otherwise a
    // reader who sends after catching up gets a "New messages" divider above their
    // own line. Mirrors the own-message exclusion in conversation-service's unread
    // counts. Conversation-wide, independent of the page cursor.
    prisma.message.findFirst({
      where: { conversationId: args.conversationId, parentId: null, kind: 'user', userId: { not: args.userId }, createdAt: { gt: member.lastReadAt } },
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

// Advance a member's read cursor to an EXACT instant (v0.11 §3.3). The `lt` guard
// makes it monotone — the cursor can only move forward — so a concurrent markRead
// from the user's own client can never be rewound, and a repeat call is idempotent.
// A non-member matches zero rows, so no {t:'read'} frame is emitted for someone who
// cannot read the channel. Deliberately a SIBLING of markRead, not a refactor of it:
// markRead's four message-pane call sites are untouched.
export async function markReadUpTo(args: { userId: string; conversationId: string; at: Date }): Promise<boolean> {
  const { count } = await prisma.conversationMember.updateMany({
    where: { conversationId: args.conversationId, userId: args.userId, lastReadAt: { lt: args.at } },
    data: { lastReadAt: args.at },
  })
  if (count > 0) await emitEvent({ t: 'read', cid: args.conversationId, uid: args.userId })
  return count > 0
}
