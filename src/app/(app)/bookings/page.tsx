import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { requireSetup } from '@/lib/org'
import { formatRange } from '@/lib/time'
import BookingsClient from './bookings-client'

export default async function MyBookingsPage() {
  const me = await requireUser()
  const org = await requireSetup()
  const now = new Date()
  const [upcoming, past] = await Promise.all([
    prisma.booking.findMany({
      where: { userId: me.id, endsAt: { gte: now }, status: { in: ['PENDING', 'CONFIRMED'] } },
      include: { equipment: { select: { name: true, location: true } } }, orderBy: { startsAt: 'asc' },
    }),
    prisma.booking.findMany({
      where: { userId: me.id, OR: [{ endsAt: { lt: now } }, { status: { in: ['REJECTED', 'CANCELLED', 'EXPIRED'] } }] },
      include: { equipment: { select: { name: true, location: true } } }, orderBy: { startsAt: 'desc' }, take: 30,
    }),
  ])
  const shape = (b: (typeof upcoming)[number]) => ({
    id: b.id, equipmentName: b.equipment.name, when: formatRange(b.startsAt, b.endsAt, org.timezone),
    status: b.status, recurring: !!b.recurrenceRuleId, cancellable: b.startsAt > now && ['PENDING', 'CONFIRMED'].includes(b.status),
    reason: b.rejectionReason,
    startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), purpose: b.purpose, location: b.equipment.location,
  })
  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — My bookings</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">My bookings</h1>
      <BookingsClient upcoming={upcoming.map(shape)} past={past.map(shape)} />
    </div>
  )
}
