import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { formatRange } from '@/lib/time'
import { bookingPendingEmail, bookingDecidedEmail } from '@/lib/email/templates'
import { isManagerOf } from '@/features/equipment/service'
import { isCertified } from '@/features/certifications/service'
import { evaluateBooking, type Verdict, type Role, type PolicyInput } from './policy'

export type CreateBookingInput = { userId: string; equipmentId: string; startsAt: Date; endsAt: Date; purpose: string }
export type CreateBookingResult =
  | { ok: true; bookingId: string; pending: boolean }
  | { ok: false; error: 'blocked'; message: string }
  | { ok: false; error: 'slot_taken' }
  | { ok: false; error: 'not_found' }

export function isOverlapError(e: unknown): boolean {
  const msg = String(e instanceof Prisma.PrismaClientKnownRequestError ? e.message : e)
  // The exclusion constraint (23P01) is the primary signal that the slot is taken.
  // Under concurrency PostgreSQL may instead resolve the contention as a deadlock
  // (40P01): the loser could not claim the slot, which is the same outcome for the
  // caller. Treat both as "slot taken" so a losing request degrades gracefully
  // instead of surfacing a 500. Prisma 7 also maps deadlocks to write-conflict P2034.
  return (
    msg.includes('booking_no_overlap') ||
    msg.toLowerCase().includes('deadlock') ||
    (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034')
  )
}

async function orgInfo() {
  const org = await prisma.organization.findFirst()
  return { name: org?.name ?? 'LabHub', tz: org?.timezone ?? 'Asia/Singapore' }
}

export async function buildPolicyInput(
  userId: string, equipmentId: string, slot: { startsAt: Date; endsAt: Date }, recurring: boolean,
): Promise<PolicyInput | null> {
  const [user, eq] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.equipment.findUnique({ where: { id: equipmentId } }),
  ])
  if (!user || !eq) return null
  const [manager, certified, maintenance] = await Promise.all([
    isManagerOf(userId, equipmentId),
    isCertified(userId, equipmentId),
    prisma.maintenanceWindow.findMany({
      where: { equipmentId, startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt } },
      select: { startsAt: true, endsAt: true },
    }),
  ])
  return {
    now: new Date(), role: user.role as Role, isManager: manager, isCertified: certified,
    equipment: eq, slot, recurring, maintenance,
  }
}

export async function notifyManagersOfPending(equipmentId: string, requesterName: string, when: string): Promise<void> {
  const { name: orgName } = await orgInfo()
  const eq = await prisma.equipment.findUniqueOrThrow({ where: { id: equipmentId } })
  const managers = await prisma.equipmentManager.findMany({ where: { equipmentId }, select: { userId: true } })
  const admins = await prisma.user.findMany({ where: { role: 'admin', banned: false }, select: { id: true } })
  const targets = [...new Set([...managers.map((m) => m.userId), ...admins.map((a) => a.id)])]
  const mail = bookingPendingEmail(orgName, requesterName, eq.name, when)
  await Promise.all(targets.map((id) =>
    notify(id, 'booking_pending', { message: `${requesterName} requested ${eq.name}, ${when}` }, mail),
  ))
}

export async function previewBooking(
  input: Omit<CreateBookingInput, 'purpose'> & { recurring?: boolean },
): Promise<Verdict | { kind: 'blocked'; reason: 'slot_taken'; message: string }> {
  const ctx = await buildPolicyInput(input.userId, input.equipmentId, { startsAt: input.startsAt, endsAt: input.endsAt }, input.recurring ?? false)
  if (!ctx) return { kind: 'blocked', reason: 'slot_taken', message: 'Equipment not found.' }
  const verdict = evaluateBooking(ctx)
  if (verdict.kind === 'blocked') return verdict
  const clash = await prisma.booking.findFirst({
    where: { equipmentId: input.equipmentId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
  })
  if (clash) return { kind: 'blocked', reason: 'slot_taken', message: 'That time is already booked.' }
  return verdict
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const ctx = await buildPolicyInput(input.userId, input.equipmentId, { startsAt: input.startsAt, endsAt: input.endsAt }, false)
  if (!ctx) return { ok: false, error: 'not_found' }
  const verdict = evaluateBooking(ctx)
  if (verdict.kind === 'blocked') return { ok: false, error: 'blocked', message: verdict.message }
  const pending = verdict.kind === 'approval'
  try {
    // Serialize concurrent inserts for the same instrument behind a transaction-scoped
    // advisory lock keyed on equipmentId. Without it, two overlapping inserts each hold
    // predicate locks the other's exclusion-constraint check needs, and PostgreSQL
    // resolves the cycle as a deadlock (non-deterministic winner, surfaced as a 500).
    // With the lock, inserts run one at a time per instrument: the loser sees the
    // committed row and gets a clean booking_no_overlap violation → slot_taken. The
    // lock is released automatically at COMMIT/ROLLBACK. The constraint remains the
    // sole source of truth for overlap — this only orders the contenders.
    const booking = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.equipmentId}, 0))`
      return tx.booking.create({
        data: {
          userId: input.userId, equipmentId: input.equipmentId,
          startsAt: input.startsAt, endsAt: input.endsAt,
          purpose: input.purpose.slice(0, 500), status: pending ? 'PENDING' : 'CONFIRMED',
        },
      })
    })
    if (pending) {
      const { tz } = await orgInfo()
      const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } })
      await notifyManagersOfPending(input.equipmentId, user.name, formatRange(input.startsAt, input.endsAt, tz))
    }
    return { ok: true, bookingId: booking.id, pending }
  } catch (e) {
    if (isOverlapError(e)) return { ok: false, error: 'slot_taken' }
    throw e
  }
}

export async function decideBooking(args: { bookingId: string; deciderId: string; decision: 'approve' | 'reject'; reason?: string }): Promise<{ ok: boolean; message?: string }> {
  const b = await prisma.booking.findUnique({ where: { id: args.bookingId }, include: { equipment: true } })
  if (!b || b.status !== 'PENDING') return { ok: false, message: 'This request is no longer pending.' }
  if (!(await isManagerOf(args.deciderId, b.equipmentId))) return { ok: false, message: 'Only equipment managers can decide this request.' }
  if (args.decision === 'reject' && !args.reason?.trim()) return { ok: false, message: 'A rejection reason is required.' }

  const approved = args.decision === 'approve'
  await prisma.booking.update({
    where: { id: b.id },
    data: { status: approved ? 'CONFIRMED' : 'REJECTED', decidedById: args.deciderId, decidedAt: new Date(), rejectionReason: approved ? null : args.reason!.trim() },
  })
  const { name: orgName, tz } = await orgInfo()
  const when = formatRange(b.startsAt, b.endsAt, tz)
  await notify(b.userId, 'booking_decided',
    { message: `${b.equipment.name} ${when}: ${approved ? 'approved' : `rejected — ${args.reason}`}` },
    bookingDecidedEmail(orgName, b.equipment.name, when, approved, args.reason))
  return { ok: true }
}

export async function cancelBooking(args: { bookingId: string; byUserId: string }): Promise<{ ok: boolean; message?: string }> {
  const b = await prisma.booking.findUnique({ where: { id: args.bookingId } })
  if (!b) return { ok: false, message: 'Booking not found.' }
  if (!['PENDING', 'CONFIRMED'].includes(b.status)) return { ok: false, message: 'This booking cannot be cancelled.' }
  if (b.startsAt <= new Date()) return { ok: false, message: 'Past or in-progress bookings cannot be cancelled.' }
  const allowed = b.userId === args.byUserId || (await isManagerOf(args.byUserId, b.equipmentId))
  if (!allowed) return { ok: false, message: 'You can only cancel your own bookings.' }
  await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } })
  return { ok: true }
}
