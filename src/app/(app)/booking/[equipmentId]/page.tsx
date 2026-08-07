import { notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { requireSetup } from '@/lib/org'
import { isManagerOf } from '@/features/equipment/service'
import { dayAnchor } from '@/lib/tz'
import { addDays, format, startOfWeek } from 'date-fns'
import ScheduleView, { type CalSlot } from '@/components/schedule-view'
import NewBookingButton from '@/components/booking/new-booking-button'
import MaintenanceDialogButton from './maintenance-dialog'

export default async function EquipmentPage({ params, searchParams }: {
  params: Promise<{ equipmentId: string }>
  searchParams: Promise<{ week?: string; day?: string }>
}) {
  const me = await requireUser()
  const org = await requireSetup()
  const { equipmentId } = await params
  const { week, day } = await searchParams
  // Which day the phone day view opens on. Minted only by the day bar's
  // week-crossing links; anything else (a hand-typed or stale value) degrades to
  // undefined and the view falls back to today-in-this-week.
  const d = Number(day)
  const initialDay = Number.isInteger(d) && d >= 0 && d <= 6 ? d : undefined

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
  const weekStartISO = new Date(+weekStart).toISOString()
  const retired = eq.status === 'RETIRED'

  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — Booking</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-default">{eq.name}</h1>
        <div className="flex items-center gap-2 text-sm">
          {/* Week stepping is the md+ affordance; below it the schedule's own day
              bar subsumes it (and mints ?week= itself when it crosses a boundary). */}
          <div className="hidden items-center gap-2 md:flex">
            <Link href={`?week=${prev}`} className="rounded-md border border-border px-2 py-1 text-default transition-colors hover:bg-hover">← Prev</Link>
            <span className="font-medium text-default">{format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}</span>
            <Link href={`?week=${next}`} className="rounded-md border border-border px-2 py-1 text-default transition-colors hover:bg-hover">Next →</Link>
          </div>
          {canManage && <MaintenanceDialogButton equipmentId={equipmentId} />}
          <NewBookingButton equipmentId={equipmentId} timezone={org.timezone} allowRecurring={eq.allowRecurring}
            equipmentName={eq.name} equipmentLocation={eq.location} retired={retired} />
        </div>
      </div>

      {/* Phones stack the policy aside BELOW the schedule — booking is the primary
          task, so the schedule stays first in source and first on screen. */}
      <div className="mt-4 flex flex-col gap-6 md:flex-row">
        <div className="min-w-0 flex-1">
          {/* KEYED mount: a ?week=/?day= soft navigation reconciles rather than
              remounting, which would leave ScheduleView's seed-once day state on the
              old week. The key forces the remount (v0.12's projectOrderSignature idiom). */}
          <ScheduleView key={`${weekStartISO}:${initialDay ?? ''}`}
            equipmentId={equipmentId} timezone={org.timezone} weekStartISO={weekStartISO}
            slots={slots} canManage={canManage} selfId={me.id}
            allowRecurring={eq.allowRecurring} retired={retired}
            equipmentName={eq.name} equipmentLocation={eq.location} initialDay={initialDay} />
        </div>
        <aside className="w-full shrink-0 rounded-xl border border-border bg-surface p-4 text-sm shadow-xs md:w-64">
          <h2 className="font-medium text-default">Policy</h2>
          <ul className="mt-2 space-y-1 text-muted">
            <li>Book up to <strong className="text-default">{eq.advanceBookingDays} days</strong> ahead</li>
            <li>Max <strong className="text-default">{eq.maxDurationMinutes / 60} h</strong> per booking</li>
            <li>{eq.certificationRequired ? 'Certification required' : 'No certification needed'}</li>
            <li>Approval: <strong className="text-default">{eq.approvalPolicy === 'NONE' ? 'instant for everyone' : eq.approvalPolicy === 'GUESTS' ? 'guests need approval' : 'everyone needs approval'}</strong></li>
            <li>{eq.allowRecurring ? 'Recurring bookings allowed' : 'No recurring bookings'}</li>
          </ul>
          {eq.description && <p className="mt-3 text-muted">{eq.description}</p>}
          {eq.location && <p className="mt-1 text-subtle">📍 {eq.location}</p>}
        </aside>
      </div>
    </div>
  )
}
