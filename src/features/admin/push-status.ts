import 'server-only'
import { prisma } from '@/lib/db'

export type PushStatusRow = { id: string; name: string; pushEnabled: boolean }

// Admin visibility for notification delivery (2026-09 design): who has
// completed the push wizard. One indexed-count query; safe at lab scale.
export async function listPushStatus(): Promise<PushStatusRow[]> {
  const users = await prisma.user.findMany({
    where: { isSystem: false },
    select: { id: true, name: true, _count: { select: { pushSubscriptions: true } } },
    orderBy: { name: 'asc' },
  })
  return users.map((u) => ({ id: u.id, name: u.name, pushEnabled: u._count.pushSubscriptions > 0 }))
}
