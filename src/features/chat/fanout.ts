import 'server-only'
import type { Message, Conversation } from '@prisma/client'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { hasLiveConnection } from '@/lib/events'
import { sendPush } from '@/lib/push'
import { mentionEmail, dmEmail } from '@/lib/email/templates'
import { renderBody } from './mentions'

type Seams = {
  hasLive?: (uid: string) => boolean
  push?: (uid: string, p: { title: string; body: string; url: string }) => Promise<void>
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
    const push = seams.push ?? sendPush
    const { message: m, conversation: c } = args
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: c.id, userId: { not: m.userId } },
      include: { user: { select: { id: true, name: true, banned: true, isSystem: true } } },
    })
    const names = new Map(members.map((x) => [x.user.id, x.user.name]))
    const preview = (m.body ? renderBody(m.body, names) : '(attachment)').slice(0, 120)
    const org = await prisma.organization.findFirst()
    const orgName = org?.name ?? 'COLOSSUS'
    const where = c.type === 'DM' ? 'a direct message' : `#${c.name ?? 'channel'}`
    const url = `/chat/${c.id}`

    for (const member of members) {
      if (member.user.banned || member.user.isSystem) continue
      const direct = m.mentionUserIds.includes(member.userId)
      // Mute suppresses everything except direct <@userId> mentions.
      // Channels: only mentions notify (direct or @channel). DMs: every message notifies.
      const shouldNotify = direct || (!member.muted && (c.type === 'DM' || m.mentionsChannel))
      if (!shouldNotify) continue
      const type = c.type === 'DM' ? 'message_dm' as const : 'message_mention' as const
      const offline = !hasLive(member.userId)
      const email = offline
        ? (c.type === 'DM' ? dmEmail(orgName, args.senderName, preview) : mentionEmail(orgName, args.senderName, where, preview))
        : undefined
      await notify(member.userId, type, { message: `${args.senderName} in ${where}: ${preview}`, conversationId: c.id, messageId: m.id }, email)
      if (offline) {
        await push(member.userId, { title: `${args.senderName} — ${where}`, body: preview, url }).catch(() => {})
      }
    }
  } catch (e) {
    console.error('fanoutMessage failed', e) // fan-out must never break sending
  }
}
