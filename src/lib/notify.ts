import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from './db'
import { enqueueEmail } from './email/outbox'
import { emitEvent } from './events'

export type NotificationType =
  | 'booking_pending' | 'booking_decided' | 'booking_cancelled_maintenance'
  | 'booking_reminder' | 'booking_expired' | 'booking_cancelled'
  | 'message_mention' | 'message_dm' | 'channel_added'
  // F8: a reply in a thread you participate in — bell-only (no immediate email);
  // unread rows reach the 60-minute digest job instead.
  | 'message_thread_reply'
  | 'issue_assigned' | 'issue_mention' | 'issue_comment' | 'issue_done'
  // SP8: weekly project-update prompt (suppressed bot DM + this no-email bell)
  | 'project_update_prompt'
  // v0.13 feedback: in-app only — admins on every submission, the author on a
  // decision. Both are three-arg (no email) and carry { feedbackId, message }.
  | 'feedback_new' | 'feedback_decided'

export async function notify(
  userId: string, type: NotificationType, payload: Record<string, unknown>,
  email?: { subject: string; html: string },
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return
    // payload is validated JSON at the call sites; Prisma's Json input type
    // (InputJsonValue) is narrower than Record<string, unknown>, so cast here.
    // immediate-email rows are exempt from the 60-min digest (emailedAt is the latch)
    await prisma.notification.create({ data: { userId, type, payload: payload as Prisma.InputJsonValue, ...(email ? { emailedAt: new Date() } : {}) } })
    void emitEvent({ t: 'notif', uid: userId }) // live bell push; emitEvent never throws
    if (email) await enqueueEmail(user.email, email.subject, email.html)
  } catch (e) {
    console.error('notify failed', e) // notifications must never break the calling action
  }
}
