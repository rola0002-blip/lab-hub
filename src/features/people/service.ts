import 'server-only'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { formatRange } from '@/lib/time'
import { bookingCancelledUserDeactivatedEmail } from '@/lib/email/templates'

export async function deactivateUser(userId: string): Promise<void> {
  const user = await prisma.user.update({ where: { id: userId }, data: { banned: true, banReason: 'Deactivated by admin' } })
  await prisma.session.deleteMany({ where: { userId } })
  const org = await prisma.organization.findFirst()
  // Converging loop: a booking inserted concurrently between snapshot and update would be
  // missed by a single findMany. The user is already banned with sessions deleted, so they
  // can create no new bookings; repeated passes drain in-flight inserts that passed auth
  // before the ban until findMany returns empty.
  for (;;) {
    const victims = await prisma.booking.findMany({
      where: { userId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gt: new Date() } },
      include: { equipment: { include: { managers: true } } },
    })
    if (victims.length === 0) break
    await prisma.booking.updateMany({
      where: { id: { in: victims.map((v) => v.id) } },
      data: { status: 'CANCELLED', rejectionReason: 'User deactivated' },
    })
    for (const b of victims) {
      const when = formatRange(b.startsAt, b.endsAt, org?.timezone ?? 'Asia/Singapore')
      await Promise.all(b.equipment.managers.map((m) =>
        notify(m.userId, 'booking_cancelled',
          { message: `${user.name} was deactivated; their booking of ${b.equipment.name} (${when}) was cancelled.` },
          bookingCancelledUserDeactivatedEmail(org?.name ?? 'LabHub', user.name, b.equipment.name, when)),
      ))
    }
  }
}

export async function reactivateUser(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { banned: false, banReason: null } })
}

export async function setUserRole(userId: string, role: 'admin' | 'member' | 'guest'): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role } })
}
