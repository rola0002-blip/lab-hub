import 'server-only'
import { prisma } from '@/lib/db'
import { getOrCreateDm } from '@/features/chat/conversation-service'
import { sendMessage } from '@/features/chat/message-service'
import { neutralizeMentions } from '@/features/chat/mentions'

// COLOSSUS Bot — the single isSystem=true account. The fixed ids live in the pure
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
export async function announceToChannel(text: string): Promise<void> {
  try {
    await ensureBotInChannel()
    await sendMessage({ userId: COLOSSUS_BOT_ID, conversationId: LAB_UPDATES_CHANNEL_ID, body: neutralizeMentions(text) })
  } catch (e) {
    console.error('bot.announceToChannel failed', e)
  }
}

// DM a user as the bot. `suppress` toggles the one-bell path for natively-notified
// events (booking pending/decided/reminder); leave it off for the issue-due-soon DM
// (no native notification → the normal DM fan-out provides the single message_dm bell).
export async function dmUser(userId: string, text: string, opts: { suppress?: boolean } = {}): Promise<void> {
  try {
    const dm = await getOrCreateDm({ userIds: [COLOSSUS_BOT_ID, userId], byId: COLOSSUS_BOT_ID })
    if (!dm.ok) return
    // Same neutralization as announceToChannel: the bot never produces a mention,
    // so a token in the interpolated text can't bypass a peer's mute via <@id>.
    await sendMessage({ userId: COLOSSUS_BOT_ID, conversationId: dm.conversationId, body: neutralizeMentions(text), suppressNotify: opts.suppress })
  } catch (e) {
    console.error('bot.dmUser failed', e)
  }
}
