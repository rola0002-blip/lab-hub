import 'server-only'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { formatRange } from '@/lib/time'

export async function deactivateUser(userId: string): Promise<void> {
  const user = await prisma.user.update({ where: { id: userId }, data: { banned: true, banReason: 'Deactivated by admin' } })
  await prisma.session.deleteMany({ where: { userId } })
  const org = await prisma.organization.findFirst()
  const victims = await prisma.booking.findMany({
    where: { userId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gt: new Date() } },
    include: { equipment: { include: { managers: true } } },
  })
  await prisma.booking.updateMany({ where: { id: { in: victims.map((v) => v.id) } }, data: { status: 'CANCELLED' } })
  for (const b of victims) {
    const when = formatRange(b.startsAt, b.endsAt, org?.timezone ?? 'Asia/Singapore')
    await Promise.all(b.equipment.managers.map((m) =>
      notify(m.userId, 'booking_cancelled', { message: `${user.name} was deactivated; their booking of ${b.equipment.name} (${when}) was cancelled.` }),
    ))
  }
}

export async function reactivateUser(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { banned: false, banReason: null } })
}

export async function setUserRole(userId: string, role: 'admin' | 'member' | 'guest'): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role } })
}
