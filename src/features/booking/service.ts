import 'server-only'
import { Prisma } from '@prisma/client'
import { env } from '@/lib/env'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { formatRange } from '@/lib/time'
import { bookingPendingEmail, bookingDecidedEmail } from '@/lib/email/templates'
import { isManagerOf } from '@/features/equipment/service'
import { isCertified } from '@/features/certifications/service'
import * as bot from '@/features/bot'
import { evaluateBooking, type Verdict, type Role, type PolicyInput } from './policy'
import { expandWeekly } from './recurrence'

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
  await Promise.all(targets.map((id) =>
    bot.dmUser(id, `${requesterName} requested ${eq.name}, ${when} — needs your approval.`, { suppress: true }),
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
    bookingDecidedEmail(orgName, b.equipment.name, when, approved, args.reason,
      { appUrl: env.APP_URL, event: { startsAt: b.startsAt, endsAt: b.endsAt, location: b.equipment.location } }))
  await bot.dmUser(b.userId, `${b.equipment.name} ${when}: ${approved ? 'approved' : `rejected — ${args.reason}`}`, { suppress: true })
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

export type CreateRecurringInput = {
  userId: string; equipmentId: string; purpose: string
  daysOfWeek: number[]; startMinutes: number; durationMinutes: number
  firstDate: string; untilDate: string
}
export type CreateRecurringResult =
  | { ok: true; ruleId: string; count: number; pending: boolean }
  | { ok: false; error: 'blocked'; message: string }
  | { ok: false; error: 'conflicts'; conflicts: string[] }
  | { ok: false; error: 'not_found' }

export async function createRecurringBooking(input: CreateRecurringInput): Promise<CreateRecurringResult> {
  const { tz } = await orgInfo()
  const occurrences = expandWeekly({ ...input, timezone: tz })
  if (occurrences.length === 0) return { ok: false, error: 'blocked', message: 'The pattern produces no occurrences.' }
  if (occurrences.length > 200) return { ok: false, error: 'blocked', message: 'Too many occurrences (max 200). Shorten the date range.' }

  // Policy check on the first occurrence (recurring=true gates allowRecurring and
  // skips the advance window; approval routing now follows the per-equipment policy).
  const ctx = await buildPolicyInput(input.userId, input.equipmentId, occurrences[0], true)
  if (!ctx) return { ok: false, error: 'not_found' }
  const verdict = evaluateBooking(ctx)
  if (verdict.kind === 'blocked') return { ok: false, error: 'blocked', message: verdict.message }
  // The verdict is uniform across occurrences: role and approvalPolicy are per-
  // equipment, and per-occurrence overlap/maintenance is checked separately below.
  const pending = verdict.kind === 'approval'

  // Per-occurrence checks: booking + maintenance overlap, computed in bulk.
  const [bookings, windows] = await Promise.all([
    prisma.booking.findMany({
      where: { equipmentId: input.equipmentId, status: { in: ['PENDING', 'CONFIRMED'] }, endsAt: { gt: occurrences[0].startsAt } },
      select: { startsAt: true, endsAt: true },
    }),
    prisma.maintenanceWindow.findMany({ where: { equipmentId: input.equipmentId }, select: { startsAt: true, endsAt: true } }),
  ])
  const blockers = [...bookings, ...windows]
  const conflicts = occurrences.filter((o) => blockers.some((b) => b.startsAt < o.endsAt && b.endsAt > o.startsAt))
  if (conflicts.length > 0) {
    return { ok: false, error: 'conflicts', conflicts: conflicts.map((c) => formatRange(c.startsAt, c.endsAt, tz)) }
  }

  try {
    const rule = await prisma.$transaction(async (tx) => {
      // Same per-equipment advisory lock as createBooking: serialize the rule + N
      // booking inserts behind the transaction-scoped lock keyed on equipmentId so
      // overlapping inserts don't cycle into a GiST deadlock. Released at COMMIT/ROLLBACK.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.equipmentId}, 0))`
      const rule = await tx.recurrenceRule.create({
        data: {
          equipmentId: input.equipmentId, userId: input.userId,
          daysOfWeek: input.daysOfWeek, startMinutes: input.startMinutes,
          durationMinutes: input.durationMinutes, firstDate: input.firstDate, untilDate: input.untilDate,
        },
      })
      for (const o of occurrences) {
        await tx.booking.create({
          data: {
            userId: input.userId, equipmentId: input.equipmentId, purpose: input.purpose.slice(0, 500),
            startsAt: o.startsAt, endsAt: o.endsAt, status: pending ? 'PENDING' : 'CONFIRMED', recurrenceRuleId: rule.id,
          },
        })
      }
      return rule
    })
    if (pending) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } })
      const first = formatRange(occurrences[0].startsAt, occurrences[0].endsAt, tz)
      await notifyManagersOfPending(input.equipmentId, user.name, `recurring ×${occurrences.length}, first ${first}`)
    }
    return { ok: true, ruleId: rule.id, count: occurrences.length, pending }
  } catch (e) {
    if (isOverlapError(e)) return { ok: false, error: 'conflicts', conflicts: ['A slot was taken while submitting. Try again.'] }
    throw e
  }
}

export async function decideRecurring(args: { ruleId: string; deciderId: string; decision: 'approve' | 'reject'; reason?: string }): Promise<{ ok: boolean; message?: string }> {
  const rule = await prisma.recurrenceRule.findUnique({ where: { id: args.ruleId }, include: { equipment: true } })
  if (!rule) return { ok: false, message: 'Request not found.' }
  if (!(await isManagerOf(args.deciderId, rule.equipmentId))) return { ok: false, message: 'Only equipment managers can decide this request.' }
  if (args.decision === 'reject' && !args.reason?.trim()) return { ok: false, message: 'A rejection reason is required.' }
  const approved = args.decision === 'approve'
  const { count } = await prisma.booking.updateMany({
    where: { recurrenceRuleId: rule.id, status: 'PENDING' },
    data: { status: approved ? 'CONFIRMED' : 'REJECTED', decidedById: args.deciderId, decidedAt: new Date(), rejectionReason: approved ? null : args.reason!.trim() },
  })
  if (count === 0) return { ok: false, message: 'This request is no longer pending.' }
  const { name: orgName } = await orgInfo()
  await notify(rule.userId, 'booking_decided',
    { message: `Recurring booking of ${rule.equipment.name} (${count} slots): ${approved ? 'approved' : `rejected — ${args.reason}`}` },
    bookingDecidedEmail(orgName, rule.equipment.name, `recurring ×${count}`, approved, args.reason, { appUrl: env.APP_URL }))
  await bot.dmUser(rule.userId, `Recurring booking of ${rule.equipment.name} (${count} slots): ${approved ? 'approved' : `rejected — ${args.reason}`}`, { suppress: true })
  return { ok: true }
}

export async function cancelRecurring(args: { bookingId: string; byUserId: string; scope: 'one' | 'future' }): Promise<{ ok: boolean; message?: string }> {
  if (args.scope === 'one') return cancelBooking({ bookingId: args.bookingId, byUserId: args.byUserId })
  const b = await prisma.booking.findUnique({ where: { id: args.bookingId } })
  if (!b?.recurrenceRuleId) return { ok: false, message: 'Not a recurring booking.' }
  const allowed = b.userId === args.byUserId || (await isManagerOf(args.byUserId, b.equipmentId))
  if (!allowed) return { ok: false, message: 'You can only cancel your own bookings.' }
  await prisma.booking.updateMany({
    where: { recurrenceRuleId: b.recurrenceRuleId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { gte: b.startsAt, gt: new Date() } },
    data: { status: 'CANCELLED' },
  })
  return { ok: true }
}
