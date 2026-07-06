import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from './db'
import { enqueueEmail } from './email/outbox'

export type NotificationType =
  | 'booking_pending' | 'booking_decided' | 'booking_cancelled_maintenance'
  | 'booking_reminder' | 'booking_expired' | 'booking_cancelled'

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
    if (email) await enqueueEmail(user.email, email.subject, email.html)
  } catch (e) {
    console.error('notify failed', e) // notifications must never break the calling action
  }
}
