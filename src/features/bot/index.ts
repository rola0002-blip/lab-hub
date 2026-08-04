import 'server-only'
import { prisma } from '@/lib/db'
import { getOrCreateDm } from '@/features/chat/conversation-service'
import { sendMessage, markReadUpTo } from '@/features/chat/message-service'
import { neutralizeMentions } from '@/features/chat/mentions'

// LabHub Bot — the single isSystem=true account. The fixed ids live in the pure
// ./ids module (no `server-only`) so the seed migration, runtime code, and the
// Playwright e2e runner agree; re-export them here for existing `@/features/bot`
// importers.
import { COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from './ids'
export { COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID }

// Every bot call is NON-FATAL: internal try/catch + console.error, never throws, so a
// bot failure can never break the host mutation (mirrors notify()/fanoutMessage).
// Callers invoke these AFTER the primary mutation commits.

async function ensureBotInChannel(): Promise<void> {
  await prisma.conversationMember.upsert({
    where: { conversationId_userId: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: COLOSSUS_BOT_ID } },
    update: {},
    create: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: COLOSSUS_BOT_ID },
  })
}

// Post to #lab-updates as the bot. Normal (non-suppressed) send path: a CHANNEL post
// with no @-mention fans out but notifies no one (fanout.ts) — posted, not pinged.
// The body interpolates user-controlled text (issue/project/document/user names), so
// neutralize any literal mention tokens first: the bot must never @-mention (§5.4),
// and without this a title like `<!channel>` would bell + email + push the whole org.
export async function announceToChannel(text: string, actorId?: string): Promise<void> {
  try {
    await ensureBotInChannel()
    const sent = await sendMessage({ userId: COLOSSUS_BOT_ID, conversationId: LAB_UPDATES_CHANNEL_ID, body: neutralizeMentions(text) })
    // v0.11 §3.3 — own-action exclusion. The bot posts as itself, and every unread
    // predicate excludes only the READER's own messages, so without this the act of
    // filing an issue / uploading a file / creating or editing a project / posting an
    // update bumps the actor's OWN Chat badge. Runs entirely AFTER the insert, inside
    // the same try, so the function's non-fatal contract (:14-16) is preserved.
    if (!actorId || !sent.ok) return
    const m = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: actorId } },
      select: { lastReadAt: true },
    })
    if (!m) return
    const at = new Date(sent.message.createdAt)    // MessageDto.createdAt is an ISO string, not a Date
    // Character-identical to listConversations' unread predicate (conversation-service.ts:188)
    // plus an upper bound that excludes the announce we just wrote — so `behind === 0`
    // means exactly "their unread count for this channel was 0 a moment ago".
    const behind = await prisma.message.count({
      where: {
        conversationId: LAB_UPDATES_CHANNEL_ID, kind: 'user', deletedAt: null,
        userId: { not: actorId }, createdAt: { gt: m.lastReadAt, lt: at },
      },
    })
    // Caught up ⇒ advance past the announce. Behind ⇒ do nothing: it joins the pile
    // they have yet to read, and marking it read would hide other people's messages.
    if (behind === 0) await markReadUpTo({ userId: actorId, conversationId: LAB_UPDATES_CHANNEL_ID, at })
  } catch (e) {
    console.error('bot.announceToChannel failed', e)
  }
}

// DM a user as the bot. `suppress` toggles the one-bell path for natively-notified
// events (booking pending/decided/reminder); leave it off for the issue-due-soon DM
// (no native notification → the normal DM fan-out provides the single message_dm bell).
// Returns the DM's conversation id + created message id so callers (the SP8 prompt
// job) can hang a deep-linking notify() payload off the exact message — or null when
// the DM could not be delivered (banned recipient, send failure): SP8 §4.0/§4.5.
export async function dmUser(
  userId: string, text: string, opts: { suppress?: boolean } = {},
): Promise<{ conversationId: string; messageId: string } | null> {
  try {
    const dm = await getOrCreateDm({ userIds: [COLOSSUS_BOT_ID, userId], byId: COLOSSUS_BOT_ID })
    if (!dm.ok) return null
    // Same neutralization as announceToChannel: the bot never produces a mention,
    // so a token in the interpolated text can't bypass a peer's mute via <@id>.
    const sent = await sendMessage({ userId: COLOSSUS_BOT_ID, conversationId: dm.conversationId, body: neutralizeMentions(text), suppressNotify: opts.suppress })
    return sent.ok ? { conversationId: dm.conversationId, messageId: sent.message.id } : null
  } catch (e) {
    console.error('bot.dmUser failed', e)
    return null
  }
}
