import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from './db'
import { enqueueEmail } from './email/outbox'
import { emitEvent } from './events'
import { isActive } from './activity'
import { tryReservePush } from './push-squelch'
import { sendPush } from './push'
import { isRowAlertable } from './chime'
import { notificationTitle } from './notification-label'
import { notificationHref } from './notification-href'

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
  // v0.32 training requests: the deciders on a new open request (W21-A: the
  // instrument's active managers, admins only when it has none); the requester
  // on a decision. Both are three-arg (no email) and carry { message } only —
  // the booking_* posture (the queue is in-app, no deep-link id).
  | 'training_request' | 'training_decided'

export async function notify(
  userId: string, type: NotificationType, payload: Record<string, unknown>,
  email?: { subject: string; html: string },
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return
    // payload is validated JSON at the call sites; Prisma's Json input type
    // (InputJsonValue) is narrower than Record<string, unknown>, so cast here.
    const row = await prisma.notification.create({ data: { userId, type, payload: payload as Prisma.InputJsonValue } })
    void emitEvent({ t: 'notif', uid: userId }) // live bell push; emitEvent never throws
    // W20-C: every row that does not already alert through chat fan-out pushes to
    // an IDLE user's devices — the fanout posture: activity-gated (an open tab or
    // a tray app must not silence the phone; only real recent use may), one push
    // per (user, type) per 60 s (the squelch key cannot collide with a cuid
    // conversation id), and the same title/body/url/tag the in-app popup uses so
    // the OS replaces rather than stacks. isRowAlertable is the predicate the bell
    // shares: human chat rows are pushed by fanout, bot chat rows only here.
    // Fire-and-forget (sendPush never throws; a rejection is swallowed): a
    // push-service round trip must never hold the caller's action open. The
    // block has its own try, so a push failure can never cost the email below.
    try {
      if (!user.banned && !user.isSystem && isRowAlertable({ type, payload })
        && !isActive(userId) && tryReservePush(userId, `notif:${type}`)) {
        void sendPush(userId, {
          title: notificationTitle(type),
          body: typeof payload.message === 'string' ? payload.message.slice(0, 200) : '',
          url: notificationHref({ type, payload: payload as Record<string, string> }) ?? '/',
          tag: `notif:${type}`,
        }).catch(() => {})
      }
    } catch (e) {
      console.error('notify push failed', e)
    }
    if (email) {
      // emailedAt (the "exempt from the 60-min digest" latch) is stamped only
      // AFTER the enqueue resolves: stamping in the create would silently swallow
      // the notification's digest slot if the enqueue crashed or rejected.
      await enqueueEmail(user.email, email.subject, email.html)
      await prisma.notification.update({ where: { id: row.id }, data: { emailedAt: new Date() } })
    }
  } catch (e) {
    console.error('notify failed', e) // notifications must never break the calling action
  }
}
