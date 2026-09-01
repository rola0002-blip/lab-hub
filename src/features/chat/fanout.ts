import 'server-only'
import type { Message, Conversation } from '@prisma/client'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { hasLiveConnection } from '@/lib/events'
import { isActive as isActiveUser } from '@/lib/activity'
import { tryReservePush } from '@/lib/push-squelch'
import { sendPush } from '@/lib/push'
import { mentionEmail, dmEmail } from '@/lib/email/templates'
import { renderBody } from './mentions'

type Seams = {
  hasLive?: (uid: string) => boolean
  isActive?: (uid: string) => boolean
  push?: (uid: string, p: { title: string; body: string; url: string; tag?: string }) => Promise<void>
  canPush?: (uid: string, cid: string) => boolean
}

export async function fanoutMessage(
  args: { message: Message; conversation: Conversation; senderName: string },
  seams: Seams = {},
): Promise<void> {
  try {
    // System rows (created/joined event lines) never notify anyone. conversation-
    // service never calls fanout for them; this guard makes that invariant explicit.
    if (args.message.kind === 'system') return
    const hasLive = seams.hasLive ?? hasLiveConnection
    const isActive = seams.isActive ?? isActiveUser
    const push = seams.push ?? sendPush
    const canPush = seams.canPush ?? tryReservePush
    const { message: m, conversation: c } = args
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: c.id, userId: { not: m.userId } },
      include: { user: { select: { id: true, name: true, banned: true, isSystem: true } } },
    })
    const names = new Map(members.map((x) => [x.user.id, x.user.name]))
    const preview = (m.body ? renderBody(m.body, names) : '(attachment)').slice(0, 120)
    const org = await prisma.organization.findFirst()
    const orgName = org?.name ?? 'LabHub'
    const where = c.type === 'DM' ? 'a direct message' : `#${c.name ?? 'channel'}`
    // Slack-shaped push text (2026-09): DM -> sender name, channel -> #name;
    // body "sender: preview"; tag = conversationId so the SW's
    // showNotification collapses a burst into one OS toast (W9-D7).
    const pushTitle = c.type === 'DM' ? args.senderName : `#${c.name ?? 'channel'}`
    const pushBody = `${args.senderName}: ${preview}`
    const pushUrl = `/chat/${c.id}?msg=${m.id}`
    // Bot senders (LabHub Bot announcements) must never buzz phones.
    const senderRow = await prisma.user.findUnique({ where: { id: m.userId }, select: { isSystem: true } })
    const senderIsBot = senderRow?.isSystem ?? false

    for (const member of members) {
      if (member.user.banned || member.user.isSystem) continue
      const direct = m.mentionUserIds.includes(member.userId)
      // BELL (unchanged policy): DMs always; channels on direct mention or
      // @channel. Mute suppresses the bell except for a direct <@userId> mention.
      const shouldBell = direct || (!member.muted && (c.type === 'DM' || m.mentionsChannel))
      // ALERT (2026-09, Slack-like "all new messages"): every message in an
      // unmuted conversation pings; a direct mention pierces mute. Bot
      // senders never alert.
      const shouldAlert = !senderIsBot && (direct || !member.muted)
      if (shouldBell) {
        const type = c.type === 'DM' ? 'message_dm' as const : 'message_mention' as const
        const offline = !hasLive(member.userId)
        const email = offline
          ? (c.type === 'DM' ? dmEmail(orgName, args.senderName, preview) : mentionEmail(orgName, args.senderName, where, preview))
          : undefined
        await notify(member.userId, type, { message: `${args.senderName} in ${where}: ${preview}`, conversationId: c.id, messageId: m.id, senderId: m.userId }, email)
      }
      // Push is ACTIVITY-gated, not connection-gated: an open tab or a
      // desktop app in the tray must not silence the phone — only real,
      // recent use may. The server-side squelch caps one push per
      // (user, conversation) / 60 s.
      if (shouldAlert && !isActive(member.userId) && canPush(member.userId, c.id)) {
        await push(member.userId, { title: pushTitle, body: pushBody, url: pushUrl, tag: c.id }).catch(() => {})
      }
    }
  } catch (e) {
    console.error('fanoutMessage failed', e) // fan-out must never break sending
  }
}

// F8: thread replies bell the thread's participants (root author + distinct
// repliers) — minus the sender, banned/system rows, anyone already @-mentioned
// in THIS reply (mention-wins, the issue-notification precedent), and muted
// members (a thread reply is not a direct ping). Bell-only: no immediate email
// and no push; unread rows reach the 60-min digest job instead.
export async function fanoutThreadReply(args: {
  reply: Message; root: Message; conversation: Conversation; senderName: string
}): Promise<void> {
  try {
    const { reply: m, root, conversation: c } = args
    // One-bell rule: fanoutMessage's message_dm already bells every DM message,
    // so a DM thread reply must not add a second bell (and, unlatched as it is,
    // a 60-min digest email on top of the immediate dmEmail).
    if (c.type === 'DM') return
    // System rows are root-level only; guard mirrors fanoutMessage's invariant.
    if (m.kind === 'system') return
    const replies = await prisma.message.findMany({
      where: { parentId: root.id, deletedAt: null },
      select: { userId: true }, distinct: ['userId'],
    })
    const candidateIds = [...new Set([root.userId, ...replies.map((r) => r.userId)])].filter((id) => id !== m.userId)
    if (candidateIds.length === 0) return
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: c.id, userId: { in: candidateIds } },
      include: { user: { select: { id: true, name: true, banned: true, isSystem: true } } },
    })
    const names = new Map(members.map((x) => [x.user.id, x.user.name]))
    const preview = (m.body ? renderBody(m.body, names) : '(attachment)').slice(0, 120)
    for (const member of members) {
      if (member.user.banned || member.user.isSystem) continue
      if (m.mentionUserIds.includes(member.userId)) continue // mention-wins: the mention bell already fired in fanoutMessage
      if (member.muted) continue
      await notify(member.userId, 'message_thread_reply', {
        message: `${args.senderName} in a thread: ${preview}`,
        conversationId: c.id, messageId: m.id, senderId: m.userId,
      })
    }
  } catch (e) {
    console.error('fanoutThreadReply failed', e) // fan-out must never break sending
  }
}
