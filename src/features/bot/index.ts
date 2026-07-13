import 'server-only'
import { prisma } from '@/lib/db'
import { getOrCreateDm } from '@/features/chat/conversation-service'
import { sendMessage } from '@/features/chat/message-service'

// COLOSSUS Bot — the single isSystem=true account. Fixed ids so the seed migration
// (prisma/migrations/20260713000000_sp5_calendar_bot_policy) and runtime code agree.
export const COLOSSUS_BOT_ID = 'colossus-bot'
export const LAB_UPDATES_CHANNEL_ID = 'colossus-lab-updates'

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
export async function announceToChannel(text: string): Promise<void> {
  try {
    await ensureBotInChannel()
    await sendMessage({ userId: COLOSSUS_BOT_ID, conversationId: LAB_UPDATES_CHANNEL_ID, body: text })
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
    await sendMessage({ userId: COLOSSUS_BOT_ID, conversationId: dm.conversationId, body: text, suppressNotify: opts.suppress })
  } catch (e) {
    console.error('bot.dmUser failed', e)
  }
}
