import 'server-only'
import type { Message } from '@prisma/client'
import { prisma } from './db'
import { emitEvent } from './events'

// Wave 22: every way a bell row becomes READ lives here. The badge counts EVERY
// unread row (GET /api/notifications) but the tray loads only the newest 20, and
// it used to mark just those ids — anything older stayed unread forever and
// re-badged on every refresh. Chat bells also piled up behind that window, because
// reading a conversation never touched Notification. Three exits:
//  1. markNotificationsReadUpTo — opening the tray reads every row up to the newest
//     row it loaded (a row that lands after that load stays unread).
//  2. clearConversationBells — reading a conversation reads its DM/mention bells for
//     ROOT messages up to the read instant. Thread replies stay for the tray: the
//     main pane never shows a reply, so reading the conversation is not reading it.
//  3. settleCaughtUpBells — fan-out runs AFTER the msg event, so a reader looking at
//     the conversation can mark it read before their bell row exists; fan-out
//     re-checks the cursor after inserting.

/** Chat bell types that reading a conversation clears (thread replies excluded). */
export const CONVERSATION_BELL_TYPES = ['message_dm', 'message_mention'] as const

/** Legacy tray path (tabs loaded before wave 22): read exactly these own rows. */
export async function markNotificationsRead(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0
  const { count } = await prisma.notification.updateMany({
    where: { id: { in: ids }, userId, readAt: null }, data: { readAt: new Date() },
  })
  return count
}

/** Tray open: read every unread row of this user created at or before `upTo`. */
export async function markNotificationsReadUpTo(userId: string, upTo: Date): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null, createdAt: { lte: upTo } }, data: { readAt: new Date() },
  })
  return count
}

function messageIdOf(payload: unknown): string | null {
  const v = (payload as { messageId?: unknown } | null)?.messageId
  return typeof v === 'string' ? v : null
}

/**
 * Chat read: read this user's DM/mention bells for ROOT messages of the conversation
 * created at or before `upTo`. Rows without a string messageId (pre-wave payloads)
 * are not guessed at — the tray clears them.
 */
export async function clearConversationBells(args: { userId: string; conversationId: string; upTo: Date }): Promise<number> {
  const rows = await prisma.notification.findMany({
    where: {
      userId: args.userId, readAt: null, type: { in: [...CONVERSATION_BELL_TYPES] },
      payload: { path: ['conversationId'], equals: args.conversationId },
    },
    select: { id: true, payload: true },
  })
  const messageIds = [...new Set(rows.map((r) => messageIdOf(r.payload)).filter((x): x is string => x !== null))]
  if (messageIds.length === 0) return 0
  const roots = await prisma.message.findMany({
    where: { id: { in: messageIds }, conversationId: args.conversationId, parentId: null, createdAt: { lte: args.upTo } },
    select: { id: true },
  })
  const rootIds = new Set(roots.map((r) => r.id))
  const ids = rows.filter((r) => rootIds.has(messageIdOf(r.payload) ?? '')).map((r) => r.id)
  if (ids.length === 0) return 0
  const { count } = await prisma.notification.updateMany({ where: { id: { in: ids }, readAt: null }, data: { readAt: new Date() } })
  return count
}

/**
 * Fan-out recheck. Order matters in both directions: markRead writes the cursor and
 * THEN clears rows; fan-out inserts rows and THEN calls this. Under READ COMMITTED,
 * either markRead's clear sees the inserted row, or this recheck sees the cursor.
 * Root messages only (a reply is not read by reading the conversation). Emits
 * `notif` to each settled user — their bell may already show the row.
 */
export async function settleCaughtUpBells(
  message: Pick<Message, 'id' | 'conversationId' | 'parentId' | 'createdAt'>, userIds: string[],
): Promise<string[]> {
  if (message.parentId || userIds.length === 0) return []
  const caught = await prisma.conversationMember.findMany({
    where: { conversationId: message.conversationId, userId: { in: userIds }, lastReadAt: { gte: message.createdAt } },
    select: { userId: true },
  })
  if (caught.length === 0) return []
  const rows = await prisma.notification.findMany({
    where: {
      userId: { in: caught.map((c) => c.userId) }, readAt: null, type: { in: [...CONVERSATION_BELL_TYPES] },
      payload: { path: ['messageId'], equals: message.id },
    },
    select: { id: true, userId: true },
  })
  if (rows.length === 0) return []
  await prisma.notification.updateMany({ where: { id: { in: rows.map((r) => r.id) }, readAt: null }, data: { readAt: new Date() } })
  const users = [...new Set(rows.map((r) => r.userId))]
  for (const uid of users) void emitEvent({ t: 'notif', uid }) // emitEvent never throws
  return users
}
