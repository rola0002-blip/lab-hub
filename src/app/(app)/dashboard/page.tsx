import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { requireSetup } from '@/lib/org'
import { formatRange } from '@/lib/time'
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
      <p className="text-sm font-medium text-gray-400">01 — Dashboard</p>
      <h1 className="mt-1 text-2xl font-semibold">Welcome, {me.name}</h1>

      {me.role !== 'guest' && pendingCount > 0 && (
        <Link href="/approvals" className="mt-4 block rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900">
          {pendingCount} booking request{pendingCount > 1 ? 's' : ''} waiting for approval →
        </Link>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 p-4">
          <h2 className="font-medium">Your next bookings</h2>
          {mine.length === 0 ? <p className="mt-2 text-sm text-gray-500">Nothing booked. <Link href="/booking" className="text-accent hover:underline">Reserve an instrument →</Link></p> : (
            <ul className="mt-2 space-y-1 text-sm">
              {mine.map((b) => (
                <li key={b.id}>{b.equipment.name} · {formatRange(b.startsAt, b.endsAt, org.timezone)}{b.status === 'PENDING' && <span className="ml-1 text-amber-600">(pending)</span>}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-xl border border-gray-200 p-4">
          <h2 className="font-medium">Today in the lab</h2>
          {today.length === 0 ? <p className="mt-2 text-sm text-gray-500">No bookings today.</p> : (
            <ul className="mt-2 space-y-1 text-sm">
              {today.map((b) => <li key={b.id}>{b.user.name} — {b.equipment.name} · {formatRange(b.startsAt, b.endsAt, org.timezone)}</li>)}
            </ul>
          )}
          <Link href="/booking/day" className="mt-3 block text-sm text-accent hover:underline">Full day view →</Link>
        </section>
      </div>
    </div>
  )
}
