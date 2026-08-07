import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { requireSetup } from '@/lib/org'
import { TZDate } from '@date-fns/tz'
import { dayAnchor } from '@/lib/tz'
import { addDays, format } from 'date-fns'

const START_HOUR = 7, END_HOUR = 23, PX_PER_HOUR = 40

export default async function DayViewPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireUser()
  const org = await requireSetup()
  const { date } = await searchParams
  const anchor = dayAnchor(date, org.timezone)
  const dayStart = new Date(+new TZDate(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), START_HOUR, 0, org.timezone))
  const dayEnd = new Date(+new TZDate(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), END_HOUR, 0, org.timezone))

  const equipment = await prisma.equipment.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' } })
  const [bookings, maintenance] = await Promise.all([
    prisma.booking.findMany({
      where: { status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { lt: dayEnd }, endsAt: { gt: dayStart }, equipmentId: { in: equipment.map((e) => e.id) } },
      include: { user: { select: { name: true } } },
    }),
    prisma.maintenanceWindow.findMany({ where: { startsAt: { lt: dayEnd }, endsAt: { gt: dayStart }, equipmentId: { in: equipment.map((e) => e.id) } } }),
  ])

  const height = (END_HOUR - START_HOUR) * PX_PER_HOUR
  const rect = (a: Date, b: Date) => {
    const top = Math.max((+a - +dayStart) / 3_600_000, 0) * PX_PER_HOUR
    const bottom = Math.min((+b - +dayStart) / 3_600_000, END_HOUR - START_HOUR) * PX_PER_HOUR
    return { top, height: Math.max(bottom - top, 8) }
  }
  const prev = format(addDays(anchor, -1), 'yyyy-MM-dd')
  const next = format(addDays(anchor, 1), 'yyyy-MM-dd')

  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — Booking</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold text-default">Lab schedule — {format(anchor, 'EEE d MMM yyyy')}</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`?date=${prev}`} className="rounded-md border border-border px-2 py-1 text-default transition-colors hover:bg-hover">← Prev</Link>
          <Link href={`?date=${next}`} className="rounded-md border border-border px-2 py-1 text-default transition-colors hover:bg-hover">Next →</Link>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
        <div className="grid min-w-[900px]" style={{ gridTemplateColumns: `48px repeat(${equipment.length}, minmax(140px, 1fr))` }}>
          {/* Header corner + time gutter freeze against the horizontal scroller, so the
              hours stay readable while the instrument columns pan under them. The gutter
              drops `relative` for `sticky`: both are position values (same declaration),
              and a sticky box is just as valid a containing block for its absolute hours. */}
          <div className="sticky left-0 z-20 bg-surface" />
          {equipment.map((eq) => (
            <Link key={eq.id} href={`/booking/${eq.id}`} className="border-b border-l border-border p-2 text-center text-sm font-medium text-default transition-colors hover:text-[var(--text-accent)]">{eq.name}</Link>
          ))}
          <div className="sticky left-0 z-10 bg-surface" style={{ height }}>
            {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
              <span key={i} className="absolute right-1 text-[10px] text-subtle" style={{ top: i * PX_PER_HOUR - 6 }}>{String(START_HOUR + i).padStart(2, '0')}:00</span>
            ))}
          </div>
          {equipment.map((eq) => (
            <div key={eq.id} className="relative border-l border-border" style={{ height }}>
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                <div key={i} className="absolute inset-x-0 border-t border-border" style={{ top: i * PX_PER_HOUR }} />
              ))}
              {maintenance.filter((m) => m.equipmentId === eq.id).map((m) => {
                const r = rect(m.startsAt, m.endsAt)
                return <div key={m.id} className="absolute inset-x-0.5 rounded-md border border-border bg-active px-1 text-[11px] text-muted" style={r}>Maintenance</div>
              })}
              {bookings.filter((b) => b.equipmentId === eq.id).map((b) => {
                const r = rect(b.startsAt, b.endsAt)
                return (
                  <div key={b.id} className={`absolute inset-x-0.5 overflow-hidden rounded-md px-1 text-[11px] ${b.status === 'PENDING' ? 'border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/15 text-default' : 'border border-[var(--accent)]/30 bg-accent-subtle text-[var(--text-accent)]'}`} style={r}>
                    {b.user.name}{b.status === 'PENDING' ? ' (pending)' : ''}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
