import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment } from '../factories'
import { createRecurringBooking, decideRecurring, cancelRecurring, createBooking } from '@/features/booking/service'
import { format, addDays } from 'date-fns'

const day = (n: number) => format(addDays(new Date(), n), 'yyyy-MM-dd')

function baseInput(userId: string, equipmentId: string) {
  const first = addDays(new Date(), 7)
  return {
    userId, equipmentId, purpose: 'weekly run',
    daysOfWeek: [first.getDay()], startMinutes: 14 * 60, durationMinutes: 240,
    firstDate: day(7), untilDate: day(28),
  }
}

describe('recurring bookings', () => {
  beforeEach(resetDb)

  it('creates rule + PENDING occurrences and one manager notification', async () => {
    const u = await makeUser()
    const admin = await makeUser({ role: 'admin' })
    const eq = await makeEquipment({ allowRecurring: true, approvalPolicy: 'ALL' })
    const r = await createRecurringBooking(baseInput(u.id, eq.id))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.count).toBeGreaterThanOrEqual(3)
    expect(await prisma.booking.count({ where: { recurrenceRuleId: r.ruleId, status: 'PENDING' } })).toBe(r.count)
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'booking_pending' } })).toBe(1)
  })

  it('blocks when the instrument disallows recurring', async () => {
    const u = await makeUser()
    const eq = await makeEquipment({ allowRecurring: false })
    const r = await createRecurringBooking(baseInput(u.id, eq.id))
    expect(r).toMatchObject({ ok: false, error: 'blocked' })
  })

  it('lists conflicts and creates nothing when an occurrence clashes', async () => {
    const u = await makeUser()
    const eq = await makeEquipment({ allowRecurring: true })
    const input = baseInput(u.id, eq.id)
    const first = await import('@/features/booking/recurrence').then((m) =>
      m.expandWeekly({ ...input, timezone: 'Asia/Singapore' })[0])
    await createBooking({ userId: u.id, equipmentId: eq.id, purpose: 'clash', startsAt: first.startsAt, endsAt: first.endsAt })
    const r = await createRecurringBooking(input)
    expect(r).toMatchObject({ ok: false, error: 'conflicts' })
    expect(await prisma.recurrenceRule.count()).toBe(0)
  })

  it('approve/reject covers all occurrences with one decision', async () => {
    const u = await makeUser()
    const mgr = await makeUser({ role: 'admin' })
    const eq = await makeEquipment({ allowRecurring: true, approvalPolicy: 'ALL' })
    const r = await createRecurringBooking(baseInput(u.id, eq.id))
    if (!r.ok) throw new Error('setup failed')
    await decideRecurring({ ruleId: r.ruleId, deciderId: mgr.id, decision: 'approve' })
    expect(await prisma.booking.count({ where: { recurrenceRuleId: r.ruleId, status: 'CONFIRMED' } })).toBe(r.count)
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'booking_decided' } })).toBe(1)
  })

  it('cancel scope one vs future', async () => {
    const u = await makeUser()
    const mgr = await makeUser({ role: 'admin' })
    const eq = await makeEquipment({ allowRecurring: true, approvalPolicy: 'ALL' })
    const r = await createRecurringBooking(baseInput(u.id, eq.id))
    if (!r.ok) throw new Error('setup failed')
    await decideRecurring({ ruleId: r.ruleId, deciderId: mgr.id, decision: 'approve' })
    const occ = await prisma.booking.findMany({ where: { recurrenceRuleId: r.ruleId }, orderBy: { startsAt: 'asc' } })
    await cancelRecurring({ bookingId: occ[0].id, byUserId: u.id, scope: 'one' })
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: occ[0].id } })).status).toBe('CANCELLED')
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: occ[1].id } })).status).toBe('CONFIRMED')
    await cancelRecurring({ bookingId: occ[1].id, byUserId: u.id, scope: 'future' })
    for (const o of occ.slice(1)) {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('CANCELLED')
    }
  })
})

// The series targets Mondays (daysOfWeek: [1]); pin firstDate to the next Monday
// at least a few days out so the first occurrence is never in the past, and run the
// series for 3 more weeks (4 Mondays total, matching the original fixed dates).
const nextMonday = 3 + ((8 - addDays(new Date(), 3).getDay()) % 7)

describe('createRecurringBooking follows the per-equipment policy (SP5 §3.4)', () => {
  beforeEach(resetDb)

  const recur = (userId: string, equipmentId: string) => createRecurringBooking({
    userId, equipmentId, purpose: 'series', daysOfWeek: [1], startMinutes: 9 * 60, durationMinutes: 60,
    firstDate: day(nextMonday), untilDate: day(nextMonday + 21),
  })

  it('NONE policy → the whole series inserts CONFIRMED with no manager notification', async () => {
    const u = await makeUser({ role: 'member' })
    const eq = await makeEquipment({ allowRecurring: true, approvalPolicy: 'NONE' })
    const r = await recur(u.id, eq.id)
    expect(r).toMatchObject({ ok: true, pending: false }) // instant series → result.pending false
    const rows = await prisma.booking.findMany({ where: { equipmentId: eq.id } })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((b) => b.status === 'CONFIRMED')).toBe(true)
    expect(await prisma.notification.count({ where: { type: 'booking_pending' } })).toBe(0)
  })

  it('ALL policy → the series inserts PENDING and notifies managers', async () => {
    const u = await makeUser({ role: 'member' })
    const mgr = await makeUser({ role: 'member' })
    const eq = await makeEquipment({ allowRecurring: true, approvalPolicy: 'ALL' })
    await prisma.equipmentManager.create({ data: { userId: mgr.id, equipmentId: eq.id } })
    const r = await recur(u.id, eq.id)
    expect(r).toMatchObject({ ok: true, pending: true }) // approval series → result.pending true
    const rows = await prisma.booking.findMany({ where: { equipmentId: eq.id } })
    expect(rows.every((b) => b.status === 'PENDING')).toBe(true)
    expect(await prisma.notification.count({ where: { userId: mgr.id, type: 'booking_pending' } })).toBe(1)
  })
})
