import 'server-only'
import { prisma } from '@/lib/db'

export async function deactivateUser(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { banned: true, banReason: 'Deactivated by admin' } })
  await prisma.session.deleteMany({ where: { userId } })
  // Task 13 extends this: cancel the user's future bookings + notify managers.
}

export async function reactivateUser(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { banned: false, banReason: null } })
}

export async function setUserRole(userId: string, role: 'admin' | 'member' | 'guest'): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role } })
}
