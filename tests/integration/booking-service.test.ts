import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'
import { createBooking, decideBooking, cancelBooking, previewBooking } from '@/features/booking/service'
import { setManagers } from '@/features/equipment/service'
import { grantCertification } from '@/features/certifications/service'
import { deactivateUser } from '@/features/people/service'

const slot = (a: number, b: number) => ({ startsAt: hoursFromNow(a), endsAt: hoursFromNow(b) })

describe('createBooking', () => {
  beforeEach(resetDb)

  it('member books instantly on GUESTS policy', async () => {
    const u = await makeUser()
    const eq = await makeEquipment()
    const r = await createBooking({ userId: u.id, equipmentId: eq.id, purpose: 'growth run', ...slot(24, 28) })
    expect(r).toMatchObject({ ok: true, pending: false })
    expect((await prisma.booking.findFirstOrThrow()).status).toBe('CONFIRMED')
  })

  it('guest lands in PENDING and managers are notified', async () => {
    const g = await makeUser({ role: 'guest' })
    const mgr = await makeUser({ role: 'member' })
    const eq = await makeEquipment()
    await setManagers(eq.id, [mgr.id])
    const r = await createBooking({ userId: g.id, equipmentId: eq.id, purpose: 'fyp', ...slot(24, 28) })
    expect(r).toMatchObject({ ok: true, pending: true })
    expect(await prisma.notification.count({ where: { userId: mgr.id, type: 'booking_pending' } })).toBe(1)
  })

  it('policy blocks return the human message', async () => {
    const u = await makeUser()
    const eq = await makeEquipment({ certificationRequired: true })
    const r = await createBooking({ userId: u.id, equipmentId: eq.id, purpose: 'x', ...slot(24, 28) })
    expect(r).toMatchObject({ ok: false, error: 'blocked' })
    if (!r.ok && r.error === 'blocked') expect(r.message).toContain('certified')
  })

  it('PENDING holds the slot; second overlapping request gets slot_taken', async () => {
    const g = await makeUser({ role: 'guest' })
    const u = await makeUser()
    const eq = await makeEquipment()
    await createBooking({ userId: g.id, equipmentId: eq.id, purpose: 'x', ...slot(24, 28) })
    const r = await createBooking({ userId: u.id, equipmentId: eq.id, purpose: 'y', ...slot(26, 30) })
    expect(r).toMatchObject({ ok: false, error: 'slot_taken' })
  })

  it('survives a concurrent race: exactly one of two simultaneous overlapping requests wins', async () => {
    const [a, b] = [await makeUser(), await makeUser()]
    const eq = await makeEquipment()
    const results = await Promise.all([
      createBooking({ userId: a.id, equipmentId: eq.id, purpose: 'a', ...slot(24, 28) }),
      createBooking({ userId: b.id, equipmentId: eq.id, purpose: 'b', ...slot(25, 29) }),
    ])
    const wins = results.filter((r) => r.ok).length
    const losses = results.filter((r) => !r.ok && r.error === 'slot_taken').length
    expect(wins).toBe(1)
    expect(losses).toBe(1)
  })

  it('previewBooking reports slot_taken for an occupied slot', async () => {
    const u = await makeUser()
    const eq = await makeEquipment()
    await createBooking({ userId: u.id, equipmentId: eq.id, purpose: 'x', ...slot(24, 28) })
    const v = await previewBooking({ userId: u.id, equipmentId: eq.id, ...slot(25, 26) })
    expect(v.kind).toBe('blocked')
  })
})

describe('decideBooking / cancelBooking', () => {
  beforeEach(resetDb)

  async function pendingBooking() {
    const g = await makeUser({ role: 'guest' })
    const mgr = await makeUser({ role: 'member' })
    const eq = await makeEquipment()
    await setManagers(eq.id, [mgr.id])
    await createBooking({ userId: g.id, equipmentId: eq.id, purpose: 'x', ...slot(24, 28) })
    const b = await prisma.booking.findFirstOrThrow()
    return { g, mgr, eq, b }
  }

  it('manager approves; requester notified', async () => {
    const { g, mgr, b } = await pendingBooking()
    const r = await decideBooking({ bookingId: b.id, deciderId: mgr.id, decision: 'approve' })
    expect(r.ok).toBe(true)
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CONFIRMED')
    expect(await prisma.notification.count({ where: { userId: g.id, type: 'booking_decided' } })).toBe(1)
  })

  it('reject requires a reason and stores it', async () => {
    const { mgr, b } = await pendingBooking()
    expect((await decideBooking({ bookingId: b.id, deciderId: mgr.id, decision: 'reject' })).ok).toBe(false)
    const r = await decideBooking({ bookingId: b.id, deciderId: mgr.id, decision: 'reject', reason: 'No training record' })
    expect(r.ok).toBe(true)
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })
    expect(row.status).toBe('REJECTED')
    expect(row.rejectionReason).toBe('No training record')
  })

  it('non-managers cannot decide', async () => {
    const { b } = await pendingBooking()
    const rando = await makeUser()
    expect((await decideBooking({ bookingId: b.id, deciderId: rando.id, decision: 'approve' })).ok).toBe(false)
  })

  it('owner can cancel own future booking; stranger cannot; past bookings immutable', async () => {
    const { g, b } = await pendingBooking()
    const rando = await makeUser()
    expect((await cancelBooking({ bookingId: b.id, byUserId: rando.id })).ok).toBe(false)
    expect((await cancelBooking({ bookingId: b.id, byUserId: g.id })).ok).toBe(true)
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CONFIRMED', startsAt: hoursFromNow(-3), endsAt: hoursFromNow(-1) } })
    expect((await cancelBooking({ bookingId: b.id, byUserId: g.id })).ok).toBe(false)
  })

  it('certified guest on cert-required GUESTS instrument still routes to approval', async () => {
    // grantCertification reads the org timezone (orgToday) and requires a training
    // date — resetDb TRUNCATEs Organization, so recreate the row here (the
    // certifications.test.ts resetWithOrg pattern).
    await prisma.organization.create({ data: { name: 'Lab', timezone: 'Asia/Singapore' } })
    const g = await makeUser({ role: 'guest' })
    const admin = await makeUser({ role: 'admin' })
    const eq = await makeEquipment({ certificationRequired: true })
    await grantCertification({ userId: g.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2020-01-01' })
    const r = await createBooking({ userId: g.id, equipmentId: eq.id, purpose: 'x', ...slot(24, 28) })
    expect(r).toMatchObject({ ok: true, pending: true })
  })

  it('an approved booking email carries calendar quick-add links; a rejection does not', async () => {
    const owner = await makeUser()
    const mgr = await makeUser({ role: 'admin' })
    const eq = await makeEquipment({ name: 'CVD', location: 'Lab 2' })
    const b = await prisma.booking.create({ data: { userId: owner.id, equipmentId: eq.id, status: 'PENDING', purpose: 'run', startsAt: new Date(Date.now() + 3_600_000), endsAt: new Date(Date.now() + 7_200_000) } })
    await decideBooking({ bookingId: b.id, deciderId: mgr.id, decision: 'approve' })
    const mail = await prisma.emailOutbox.findFirstOrThrow({ where: { toEmail: owner.email }, orderBy: { createdAt: 'desc' } })
    expect(mail.html).toContain('calendar.google.com/calendar/render')
    expect(mail.html).toContain('outlook.office.com/calendar')
    expect(mail.html).toContain('/bookings')
  })
})

describe('deactivation cascade (Task 8 extension)', () => {
  beforeEach(resetDb)
  it('cancels future bookings and notifies the instrument managers', async () => {
    const u = await makeUser()
    const mgr = await makeUser({ role: 'member' })
    const eq = await makeEquipment()
    await setManagers(eq.id, [mgr.id])
    await createBooking({ userId: u.id, equipmentId: eq.id, purpose: 'x', ...slot(24, 28) })
    await deactivateUser(u.id)
    expect((await prisma.booking.findFirstOrThrow()).status).toBe('CANCELLED')
    expect(await prisma.notification.count({ where: { userId: mgr.id, type: 'booking_cancelled' } })).toBe(1)
  })
})
