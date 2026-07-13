import 'server-only'
import { prisma } from './db'
import { env } from './env'
import { notify } from './notify'
import { formatRange } from './time'
import { drainOutbox } from './email/outbox'
import { bookingReminderEmail } from './email/templates'
import * as bot from '@/features/bot'

export async function expirePendingBookings(now: Date = new Date()): Promise<number> {
  const overdue = await prisma.booking.findMany({
    where: { status: 'PENDING', startsAt: { lte: now } },
    include: { equipment: { include: { managers: true } }, user: { select: { name: true } } },
  })
  if (overdue.length === 0) return 0
  await prisma.booking.updateMany({ where: { id: { in: overdue.map((b) => b.id) } }, data: { status: 'EXPIRED' } })
  const org = await prisma.organization.findFirst()
  const tz = org?.timezone ?? 'Asia/Singapore'
  for (const b of overdue) {
    const when = formatRange(b.startsAt, b.endsAt, tz)
    const msg = `Booking request for ${b.equipment.name} (${when}) expired without a decision.`
    await notify(b.userId, 'booking_expired', { message: msg })
    await Promise.all(b.equipment.managers.map((m) => notify(m.userId, 'booking_expired', { message: `${b.user.name}: ${msg}` })))
  }
  return overdue.length
}

export async function sendBookingReminders(now: Date = new Date()): Promise<number> {
  const soon = await prisma.booking.findMany({
    where: { status: 'CONFIRMED', reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + 60 * 60_000) } },
    include: { equipment: { select: { name: true } } },
  })
  if (soon.length === 0) return 0
  const org = await prisma.organization.findFirst()
  const tz = org?.timezone ?? 'Asia/Singapore'
  for (const b of soon) {
    const when = formatRange(b.startsAt, b.endsAt, tz)
    await notify(b.userId, 'booking_reminder', { message: `Upcoming: ${b.equipment.name} ${when}` },
      bookingReminderEmail(org?.name ?? 'COLOSSUS', b.equipment.name, when))
    await bot.dmUser(b.userId, `Upcoming: ${b.equipment.name} ${when}.`, { suppress: true })
    await prisma.booking.update({ where: { id: b.id }, data: { reminderSentAt: now } })
  }
  return soon.length
}

export function startJobs(): void {
  if (env.DISABLE_JOBS) return
  const guard = (fn: () => Promise<unknown>) => {
    let running = false
    return async () => {
      if (running) return
      running = true
      try { await fn() } catch (e) { console.error('job failed', e) } finally { running = false }
    }
  }
  setInterval(guard(() => drainOutbox()), 60_000)
  setInterval(guard(() => expirePendingBookings()), 60_000)
  setInterval(guard(() => sendBookingReminders()), 300_000)
}
