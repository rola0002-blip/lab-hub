import Link from 'next/link'
import { CalendarCheck, CalendarDays } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { requireSetup } from '@/lib/org'
import { formatRange } from '@/lib/time'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { BOOKING_VARIANT } from '@/features/booking/chip'
import { TZDate } from '@date-fns/tz'

export default async function DashboardPage() {
  const me = await requireUser()
  const org = await requireSetup()
  const now = new Date()
  const tzNow = new TZDate(now, org.timezone)
  const dayStart = new Date(+new TZDate(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate(), 0, 0, org.timezone))
  const dayEnd = new Date(+dayStart + 86_400_000)

  const managedIds = me.role === 'admin'
    ? undefined
    : (await prisma.equipmentManager.findMany({ where: { userId: me.id }, select: { equipmentId: true } })).map((m) => m.equipmentId)

  const [mine, pendingCount, today] = await Promise.all([
    prisma.booking.findMany({
      where: { userId: me.id, status: { in: ['PENDING', 'CONFIRMED'] }, endsAt: { gte: now } },
      include: { equipment: { select: { name: true } } }, orderBy: { startsAt: 'asc' }, take: 5,
    }),
    me.role === 'guest' ? Promise.resolve(0) : prisma.booking.count({
      where: { status: 'PENDING', ...(managedIds ? { equipmentId: { in: managedIds } } : {}) },
    }),
    prisma.booking.findMany({
      where: { status: 'CONFIRMED', startsAt: { lt: dayEnd }, endsAt: { gt: dayStart } },
      include: { equipment: { select: { name: true } }, user: { select: { name: true } } }, orderBy: { startsAt: 'asc' },
    }),
  ])

  return (
    <div>
      <p className="text-sm font-medium text-subtle">01 — Dashboard</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Welcome, {me.name}</h1>

      {me.role !== 'guest' && pendingCount > 0 && (
        <Link href="/approvals"
          className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4 text-sm font-medium text-default transition-colors hover:bg-[var(--color-warning)]/15">
          {pendingCount} booking request{pendingCount > 1 ? 's' : ''} waiting for approval →
        </Link>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <h2 className="font-medium text-default">Your next bookings</h2>
          {mine.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="Nothing booked yet"
              hint="Reserve an instrument and it will show up here."
              action={<Link href="/booking" className="text-sm font-medium text-accent hover:underline">Reserve an instrument →</Link>} />
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {mine.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-hover">
                  <span className="text-default">{b.equipment.name} · {formatRange(b.startsAt, b.endsAt, org.timezone)}</span>
                  <Badge variant={BOOKING_VARIANT[b.status as keyof typeof BOOKING_VARIANT]}>{b.status.toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-xl border border-border bg-surface p-4 shadow-xs">
          <h2 className="font-medium text-default">Today in the lab</h2>
          {today.length === 0 ? (
            <EmptyState icon={CalendarDays} title="A quiet day"
              hint="No bookings are scheduled today — enjoy the calm or grab a slot." />
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {today.map((b) => (
                <li key={b.id} className="rounded-lg px-2 py-1.5 text-default transition-colors hover:bg-hover">
                  {b.user.name} — {b.equipment.name} · {formatRange(b.startsAt, b.endsAt, org.timezone)}
                </li>
              ))}
            </ul>
          )}
          <Link href="/booking/day" className="mt-3 block text-sm text-accent hover:underline">Full day view →</Link>
        </section>
      </div>
    </div>
  )
}
