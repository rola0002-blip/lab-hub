import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from './db'
import { enqueueEmail } from './email/outbox'
import { emitEvent } from './events'

export type NotificationType =
  | 'booking_pending' | 'booking_decided' | 'booking_cancelled_maintenance'
  | 'booking_reminder' | 'booking_expired' | 'booking_cancelled'
  | 'message_mention' | 'message_dm' | 'channel_added'
  | 'issue_assigned' | 'issue_mention' | 'issue_comment' | 'issue_done'
  // SP8: weekly project-update prompt (suppressed bot DM + this no-email bell)
  | 'project_update_prompt'

export async function notify(
  userId: string, type: NotificationType, payload: Record<string, unknown>,
  email?: { subject: string; html: string },
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return
    // payload is validated JSON at the call sites; Prisma's Json input type
    // (InputJsonValue) is narrower than Record<string, unknown>, so cast here.
    await prisma.notification.create({ data: { userId, type, payload: payload as Prisma.InputJsonValue } })
    void emitEvent({ t: 'notif', uid: userId }) // live bell push; emitEvent never throws
    if (email) await enqueueEmail(user.email, email.subject, email.html)
  } catch (e) {
    console.error('notify failed', e) // notifications must never break the calling action
  }
}
