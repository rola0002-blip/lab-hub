import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { requireSetup } from '@/lib/org'
import { isManagerOf } from '@/features/equipment/service'
import { dayAnchor } from '@/lib/tz'
import { addDays, format, startOfWeek } from 'date-fns'
import WeekCalendar, { type CalSlot } from '@/components/week-calendar'
import MaintenanceDialogButton from './maintenance-dialog'

export default async function EquipmentPage({ params, searchParams }: {
  params: Promise<{ equipmentId: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const me = await requireUser()
  const org = await requireSetup()
  const { equipmentId } = await params
  const { week } = await searchParams

  const eq = await prisma.equipment.findUnique({ where: { id: equipmentId } })
  if (!eq) notFound()

  const anchor = dayAnchor(week, org.timezone)
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 })
  const weekEnd = addDays(weekStart, 7)

  const [bookings, maintenance, canManage] = await Promise.all([
    prisma.booking.findMany({
      where: { equipmentId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { lt: weekEnd }, endsAt: { gt: weekStart } },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.maintenanceWindow.findMany({ where: { equipmentId, startsAt: { lt: weekEnd }, endsAt: { gt: weekStart } } }),
    isManagerOf(me.id, equipmentId),
  ])

  const slots: CalSlot[] = [
    ...bookings.map((b) => ({
      id: b.id, kind: 'booking' as const, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString(),
      label: b.user.name, status: b.status, own: b.userId === me.id,
    })),
    ...maintenance.map((m) => ({
      id: m.id, kind: 'maintenance' as const, startsAt: m.startsAt.toISOString(), endsAt: m.endsAt.toISOString(), label: `Maintenance: ${m.reason}`,
    })),
  ]

  const prev = format(addDays(weekStart, -7), 'yyyy-MM-dd')
  const next = format(addDays(weekStart, 7), 'yyyy-MM-dd')

  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — Booking</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-default">{eq.name}</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`?week=${prev}`} className="rounded-md border border-border px-2 py-1 text-default transition-colors hover:bg-hover">← Prev</Link>
          <span className="font-medium text-default">{format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}</span>
          <Link href={`?week=${next}`} className="rounded-md border border-border px-2 py-1 text-default transition-colors hover:bg-hover">Next →</Link>
          {canManage && <MaintenanceDialogButton equipmentId={equipmentId} />}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        <div className="min-w-0 flex-1">
          <WeekCalendar equipmentId={equipmentId} timezone={org.timezone} weekStartISO={new Date(+weekStart).toISOString()}
            slots={slots} canManage={canManage} selfId={me.id}
            allowRecurring={eq.allowRecurring} retired={eq.status === 'RETIRED'} />
        </div>
        <aside className="w-64 shrink-0 rounded-xl border border-border bg-surface p-4 text-sm shadow-xs">
          <h2 className="font-medium text-default">Policy</h2>
          <ul className="mt-2 space-y-1 text-muted">
            <li>Book up to <strong className="text-default">{eq.advanceBookingDays} days</strong> ahead</li>
            <li>Max <strong className="text-default">{eq.maxDurationMinutes / 60} h</strong> per booking</li>
            <li>{eq.certificationRequired ? 'Certification required' : 'No certification needed'}</li>
            <li>Approval: <strong className="text-default">{eq.approvalPolicy === 'NONE' ? 'instant for everyone' : eq.approvalPolicy === 'GUESTS' ? 'guests need approval' : 'everyone needs approval'}</strong></li>
            <li>{eq.allowRecurring ? 'Recurring allowed (needs approval)' : 'No recurring bookings'}</li>
          </ul>
          {eq.description && <p className="mt-3 text-muted">{eq.description}</p>}
          {eq.location && <p className="mt-1 text-subtle">📍 {eq.location}</p>}
        </aside>
      </div>
    </div>
  )
}
