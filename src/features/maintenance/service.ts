import 'server-only'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { formatRange } from '@/lib/time'
import { bookingCancelledMaintenanceEmail } from '@/lib/email/templates'
import { isManagerOf } from '@/features/equipment/service'

export type MaintenanceResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'invalid' }
  | { ok: false; error: 'needs_confirmation'; conflicts: Array<{ id: string; when: string; userName: string }> }

export async function createMaintenanceWindow(args: {
  equipmentId: string; startsAt: Date; endsAt: Date; reason: string; byId: string; confirmCancel?: boolean
}): Promise<MaintenanceResult> {
  if (!(await isManagerOf(args.byId, args.equipmentId))) return { ok: false, error: 'forbidden' }
  if (args.endsAt <= args.startsAt || !args.reason.trim()) return { ok: false, error: 'invalid' }
  const org = await prisma.organization.findFirst()
  const tz = org?.timezone ?? 'Asia/Singapore'

  type WindowOutcome =
    | { kind: 'created'; victims: Array<{ userId: string; userName: string; equipmentName: string; startsAt: Date; endsAt: Date }> }
    | { kind: 'needs_confirmation'; conflicts: Array<{ id: string; when: string; userName: string }> }

  const outcome = await prisma.$transaction<WindowOutcome>(async (tx) => {
    // Same serialization key as createBooking: window creation and booking creation
    // for one instrument cannot interleave. Victims are re-queried AFTER the lock,
    // so a booking that committed while this tx waited on the lock is still seen.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${args.equipmentId}, 0))`
    const victims = await tx.booking.findMany({
      where: { equipmentId: args.equipmentId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { lt: args.endsAt }, endsAt: { gt: args.startsAt } },
      include: { user: { select: { name: true } }, equipment: { select: { name: true } } },
    })
    if (victims.length > 0 && !args.confirmCancel) {
      return { kind: 'needs_confirmation', conflicts: victims.map((v) => ({ id: v.id, when: formatRange(v.startsAt, v.endsAt, tz), userName: v.user.name })) }
    }
    await tx.maintenanceWindow.create({ data: { equipmentId: args.equipmentId, startsAt: args.startsAt, endsAt: args.endsAt, reason: args.reason.trim(), createdById: args.byId } })
    if (victims.length > 0) {
      await tx.booking.updateMany({ where: { id: { in: victims.map((v) => v.id) } }, data: { status: 'CANCELLED', rejectionReason: `Maintenance: ${args.reason.trim()}` } })
    }
    return { kind: 'created', victims: victims.map((v) => ({ userId: v.userId, userName: v.user.name, equipmentName: v.equipment.name, startsAt: v.startsAt, endsAt: v.endsAt })) }
  })
  if (outcome.kind === 'needs_confirmation') return { ok: false, error: 'needs_confirmation', conflicts: outcome.conflicts }
  for (const v of outcome.victims) {
    const when = formatRange(v.startsAt, v.endsAt, tz)
    await notify(v.userId, 'booking_cancelled_maintenance',
      { message: `${v.equipmentName} ${when} cancelled for maintenance: ${args.reason.trim()}` },
      bookingCancelledMaintenanceEmail(org?.name ?? 'LabHub', v.equipmentName, when, args.reason.trim()))
  }
  return { ok: true }
}

export async function deleteMaintenanceWindow(id: string, byId: string): Promise<{ ok: boolean }> {
  const w = await prisma.maintenanceWindow.findUnique({ where: { id } })
  if (!w || !(await isManagerOf(byId, w.equipmentId))) return { ok: false }
  await prisma.maintenanceWindow.delete({ where: { id } })
  return { ok: true }
}
