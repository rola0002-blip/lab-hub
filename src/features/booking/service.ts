import 'server-only'
import { Prisma } from '@prisma/client'
import type { BookingStatus } from '@prisma/client'
import { env } from '@/lib/env'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { formatRange } from '@/lib/time'
import { bookingPendingEmail, bookingDecidedEmail } from '@/lib/email/templates'
import { isManagerOf } from '@/features/equipment/service'
import { isCertified } from '@/features/certifications/service'
import * as bot from '@/features/bot'
import { evaluateBooking, type Verdict, type Role, type PolicyInput } from './policy'
import { expandWeekly, NonexistentWallTimeError } from './recurrence'
import { wallMinutes } from '@/lib/wall-time'
import { canStartSession, canEndSession } from './session'
import { approvalUnits } from './approval-units'

export type BookingListItem = {
  id: string; equipmentId: string; startsAt: Date; endsAt: Date
  status: BookingStatus; purpose: string; userId: string; userName: string
}

// The lab-wide schedule read: bookings whose [startsAt,endsAt) intersects
// [from,to) — startsAt < to && endsAt > from. All four human-decided statuses
// are returned (EXPIRED is a sweep artifact, not schedule data); pass userId to
// scope to one caller ("mine").
export async function listBookings(filter: { equipmentId?: string; userId?: string; from: Date; to: Date; statuses?: BookingStatus[] }): Promise<BookingListItem[]> {
  const rows = await prisma.booking.findMany({
    where: {
      status: { in: filter.statuses ?? ['PENDING', 'CONFIRMED'] },
      ...(filter.equipmentId ? { equipmentId: filter.equipmentId } : {}),
      ...(filter.userId ? { userId: filter.userId } : {}),
      startsAt: { lt: filter.to },
      endsAt: { gt: filter.from },
    },
    select: {
      id: true, equipmentId: true, startsAt: true, endsAt: true, status: true, purpose: true,
      userId: true, user: { select: { name: true } },
    },
    orderBy: { startsAt: 'asc' },
  })
  return rows.map(({ user, ...b }) => ({ ...b, userName: user.name }))
}

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
  const [{ tz }, user, eq] = await Promise.all([
    orgInfo(),
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
  // slotWall: the slot's wall clock in the org timezone, precomputed once so
  // evaluateBooking stays a pure function (see PolicyInput.slotWall).
  const startW = wallMinutes(slot.startsAt, tz)
  const endW = wallMinutes(slot.endsAt, tz)
  return {
    now: new Date(), role: user.role as Role, isManager: manager, isCertified: certified,
    equipment: eq, slot, recurring, maintenance,
    slotWall: { startMin: startW.min, endMin: endW.min, sameDay: startW.day === endW.day },
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

// Sentinel thrown inside the booking transactions when the post-lock maintenance
// re-check finds a window: buildPolicyInput's maintenance read races window
// creation (the exclusion constraint is booking-vs-booking only), so the overlap
// must be re-checked under the advisory lock the window transaction also takes.
class MaintenanceBlocked extends Error {}

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
      // Re-check under the lock: a maintenance window may have committed after
      // buildPolicyInput's read and before this transaction acquired the lock.
      const windows = await tx.maintenanceWindow.findMany({
        where: { equipmentId: input.equipmentId, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
        select: { startsAt: true, endsAt: true },
      })
      if (windows.length > 0) throw new MaintenanceBlocked()
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
    if (e instanceof MaintenanceBlocked) return { ok: false, error: 'blocked', message: 'The requested time overlaps scheduled maintenance.' }
    if (isOverlapError(e)) return { ok: false, error: 'slot_taken' }
    throw e
  }
}

// W20-D: the /approvals queue's size for this viewer, in the queue's own unit
// (approvalUnits: one per single, one per recurring series). Scope mirrors the
// page exactly: admins see every PENDING booking, a manager only the instruments
// they manage, everyone else (incl. a member managing nothing, and guests) 0.
export async function countPendingApprovals(user: { id: string; role: string }): Promise<number> {
  if (user.role === 'guest') return 0
  const managedIds = user.role === 'admin'
    ? undefined
    : (await prisma.equipmentManager.findMany({ where: { userId: user.id }, select: { equipmentId: true } })).map((m) => m.equipmentId)
  if (managedIds && managedIds.length === 0) return 0
  const rows = await prisma.booking.findMany({
    where: { status: 'PENDING', ...(managedIds ? { equipmentId: { in: managedIds } } : {}) },
    select: { recurrenceRuleId: true },
  })
  return approvalUnits(rows)
}

export async function decideBooking(args: { bookingId: string; deciderId: string; decision: 'approve' | 'reject'; reason?: string }): Promise<{ ok: boolean; message?: string }> {
  const b = await prisma.booking.findUnique({ where: { id: args.bookingId }, include: { equipment: true } })
  if (!b || b.status !== 'PENDING') return { ok: false, message: 'This request is no longer pending.' }
  if (!(await isManagerOf(args.deciderId, b.equipmentId))) return { ok: false, message: 'Only equipment managers can decide this request.' }
  if (args.decision === 'reject' && !args.reason?.trim()) return { ok: false, message: 'A rejection reason is required.' }

  const approved = args.decision === 'approve'
  // Status-guarded write (decideRecurring pattern): the read above can be stale —
  // an owner cancel or a rival decision landing between read and write would
  // otherwise be overwritten, resurrecting a decided/cancelled request.
  const r = await prisma.booking.updateMany({
    where: { id: b.id, status: 'PENDING' },
    data: { status: approved ? 'CONFIRMED' : 'REJECTED', decidedById: args.deciderId, decidedAt: new Date(), rejectionReason: approved ? null : args.reason!.trim() },
  })
  if (r.count === 0) return { ok: false, message: 'This request is no longer pending.' }
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
  let occurrences: Array<{ startsAt: Date; endsAt: Date }>
  try {
    occurrences = expandWeekly({ ...input, timezone: tz })
  } catch (e) {
    if (e instanceof NonexistentWallTimeError)
      return { ok: false, error: 'blocked', message: `That time does not exist on ${e.date} (daylight-saving transition).` }
    throw e
  }
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
        // Per-occurrence maintenance re-check under the lock: a window may have
        // committed after the bulk pre-check above ran.
        const windows = await tx.maintenanceWindow.findMany({
          where: { equipmentId: input.equipmentId, startsAt: { lt: o.endsAt }, endsAt: { gt: o.startsAt } },
          select: { startsAt: true, endsAt: true },
        })
        if (windows.length > 0) throw new MaintenanceBlocked()
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
    if (e instanceof MaintenanceBlocked) return { ok: false, error: 'blocked', message: 'The requested time overlaps scheduled maintenance.' }
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

// W12-C: usage session logging — the cancelBooking posture (load →
// friendly not-found → owner-or-manager → pure-policy gate with real now →
// update). Managers bypass the windows (settled D3) but never the state machine.
// Double-fire is benign — same-row last-write-wins timestamps, no row duplication
// (unlike W12-B's append-only grant).
export async function startBookingSession(args: { bookingId: string; byUserId: string }): Promise<{ ok: boolean; message?: string }> {
  const b = await prisma.booking.findUnique({ where: { id: args.bookingId } })
  if (!b) return { ok: false, message: 'Booking not found.' }
  const isMgr = await isManagerOf(args.byUserId, b.equipmentId)
  if (b.userId !== args.byUserId && !isMgr) return { ok: false, message: 'You can only log sessions on your own bookings.' }
  const v = canStartSession(b, new Date(), { manager: isMgr })
  if (!v.ok) return v
  await prisma.booking.update({ where: { id: b.id }, data: { sessionStartedAt: new Date() } })
  return { ok: true }
}

export async function endBookingSession(args: { bookingId: string; byUserId: string; note?: string }): Promise<{ ok: boolean; message?: string }> {
  const b = await prisma.booking.findUnique({ where: { id: args.bookingId } })
  if (!b) return { ok: false, message: 'Booking not found.' }
  const isMgr = await isManagerOf(args.byUserId, b.equipmentId)
  if (b.userId !== args.byUserId && !isMgr) return { ok: false, message: 'You can only log sessions on your own bookings.' }
  const v = canEndSession(b, new Date(), { manager: isMgr })
  if (!v.ok) return v
  const note = args.note?.trim()
  await prisma.booking.update({
    where: { id: b.id },
    data: note ? { sessionEndedAt: new Date(), sessionNote: note.slice(0, 1000) } : { sessionEndedAt: new Date() },
  })
  return { ok: true }
}

export async function setSessionNote(args: { bookingId: string; byUserId: string; note: string }): Promise<{ ok: boolean; message?: string }> {
  const b = await prisma.booking.findUnique({ where: { id: args.bookingId } })
  if (!b) return { ok: false, message: 'Booking not found.' }
  const isMgr = await isManagerOf(args.byUserId, b.equipmentId)
  if (b.userId !== args.byUserId && !isMgr) return { ok: false, message: 'You can only log sessions on your own bookings.' }
  if (b.status !== 'CONFIRMED' || !b.sessionStartedAt) return { ok: false, message: 'Notes can be added once the session has started.' }
  await prisma.booking.update({ where: { id: b.id }, data: { sessionNote: args.note.trim().slice(0, 1000) } })
  return { ok: true }
}
