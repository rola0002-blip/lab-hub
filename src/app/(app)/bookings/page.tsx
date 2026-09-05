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
    // W12-C: an ACTIVE session (started, not ended) stays in Upcoming even after its
    // slot ends — it must stay reachable for its 30-minute log-off window. An ENDED
    // session with a past endsAt falls through to Past below and renders its label.
    prisma.booking.findMany({
      where: { userId: me.id, status: { in: ['PENDING', 'CONFIRMED'] },
        OR: [{ endsAt: { gte: now } }, { sessionStartedAt: { not: null }, sessionEndedAt: null }] },
      include: { equipment: { select: { name: true, location: true } } }, orderBy: { startsAt: 'asc' },
    }),
    // …and Past excludes that same active-session set (the second OR) so an open
    // session never double-renders across the two lists.
    prisma.booking.findMany({
      where: { userId: me.id,
        AND: [
          { OR: [{ endsAt: { lt: now } }, { status: { in: ['REJECTED', 'CANCELLED', 'EXPIRED'] } }] },
          { OR: [{ sessionStartedAt: null }, { sessionEndedAt: { not: null } }] },
        ] },
      include: { equipment: { select: { name: true, location: true } } }, orderBy: { startsAt: 'desc' }, take: 30,
    }),
  ])
  const shape = (b: (typeof upcoming)[number]) => ({
    id: b.id, equipmentName: b.equipment.name, when: formatRange(b.startsAt, b.endsAt, org.timezone),
    status: b.status, recurring: !!b.recurrenceRuleId, cancellable: b.startsAt > now && ['PENDING', 'CONFIRMED'].includes(b.status),
    reason: b.rejectionReason,
    startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(), purpose: b.purpose, location: b.equipment.location,
    sessionStartedAt: b.sessionStartedAt?.toISOString() ?? null,
    sessionEndedAt: b.sessionEndedAt?.toISOString() ?? null,
    sessionNote: b.sessionNote ?? '',
    sessionLabel: b.sessionStartedAt && b.sessionEndedAt
      ? formatRange(b.sessionStartedAt, b.sessionEndedAt, org.timezone) : null,
  })
  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — My bookings</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">My bookings</h1>
      <BookingsClient upcoming={upcoming.map(shape)} past={past.map(shape)} />
    </div>
  )
}
