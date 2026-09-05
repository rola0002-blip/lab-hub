import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment } from '../factories'
import { setManagers } from '@/features/equipment/service'
import { startBookingSession, endBookingSession, setSessionNote } from '@/features/booking/service'

// The create-API blocks past starts, so seed bookings DIRECTLY (the booking-service
// test's direct prisma.booking.create posture) with session fields preset.
const seedBooking = async (over: { status?: string; startsAt?: Date; endsAt?: Date; sessionStartedAt?: Date | null; sessionNote?: string } = {}) => {
  const u = await makeUser()
  const eq = await makeEquipment()
  return prisma.booking.create({ data: {
    userId: u.id, equipmentId: eq.id, status: (over.status ?? 'CONFIRMED') as never,
    purpose: 'session test',
    startsAt: over.startsAt ?? new Date(Date.now() - 30 * 60_000),
    endsAt: over.endsAt ?? new Date(Date.now() + 60 * 60_000),
    sessionStartedAt: over.sessionStartedAt ?? null,
    sessionNote: over.sessionNote ?? '',
  }, include: { equipment: true } })
}

describe('startBookingSession / endBookingSession / setSessionNote (W12-C)', () => {
  beforeEach(resetDb)

  it('owner starts in-window; second start gets the exact already-logged-on message', async () => {
    const b = await seedBooking()
    const r = await startBookingSession({ bookingId: b.id, byUserId: b.userId })
    expect(r).toEqual({ ok: true })
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })
    expect(row.sessionStartedAt).not.toBeNull()
    expect(row.sessionEndedAt).toBeNull()
    const again = await startBookingSession({ bookingId: b.id, byUserId: b.userId })
    expect(again).toEqual({ ok: false, message: 'This session was already logged on.' })
  })

  it('early booking: owner rejected with the early message; manager bypasses the window', async () => {
    const b = await seedBooking({ startsAt: new Date(Date.now() + 2 * 3_600_000), endsAt: new Date(Date.now() + 3 * 3_600_000) })
    const early = await startBookingSession({ bookingId: b.id, byUserId: b.userId })
    expect(early).toEqual({ ok: false, message: 'Log-on opens 15 minutes before your booked slot.' })
    const mgr = await makeUser({ role: 'member' })
    await setManagers(b.equipmentId, [mgr.id])
    const r = await startBookingSession({ bookingId: b.id, byUserId: mgr.id })
    expect(r).toEqual({ ok: true })
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).sessionStartedAt).not.toBeNull()
  })

  it('end without start rejected; end with note stores both; omitted note preserves the existing one', async () => {
    const b = await seedBooking()
    const noStart = await endBookingSession({ bookingId: b.id, byUserId: b.userId })
    expect(noStart).toEqual({ ok: false, message: 'Log on before logging off.' })

    await startBookingSession({ bookingId: b.id, byUserId: b.userId })
    const done = await endBookingSession({ bookingId: b.id, byUserId: b.userId, note: 'pump noisy' })
    expect(done).toEqual({ ok: true })
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })
    expect(row.sessionEndedAt).not.toBeNull()
    expect(row.sessionNote).toBe('pump noisy')

    const b2 = await seedBooking({ sessionNote: 'kept', sessionStartedAt: new Date(Date.now() - 5 * 60_000) })
    const r2 = await endBookingSession({ bookingId: b2.id, byUserId: b2.userId })
    expect(r2).toEqual({ ok: true })
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b2.id } })).sessionNote).toBe('kept')
  })

  it('late log-off: owner past the 30-minute window rejected; manager can close it out', async () => {
    const b = await seedBooking({
      startsAt: new Date(Date.now() - 2 * 3_600_000),
      endsAt: new Date(Date.now() - 1 * 3_600_000),
      sessionStartedAt: new Date(Date.now() - 2 * 3_600_000),
    })
    const late = await endBookingSession({ bookingId: b.id, byUserId: b.userId })
    expect(late).toEqual({ ok: false, message: 'The log-off window (30 minutes after the slot) has closed — ask a manager to correct it.' })
    const mgr = await makeUser({ role: 'member' })
    await setManagers(b.equipmentId, [mgr.id])
    expect((await endBookingSession({ bookingId: b.id, byUserId: mgr.id, note: 'ran over, closed by manager' })).ok).toBe(true)
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })
    expect(row.sessionEndedAt).not.toBeNull()
    expect(row.sessionNote).toBe('ran over, closed by manager')
  })

  it('PENDING booking rejects start; unrelated member gets the own-bookings message', async () => {
    const b = await seedBooking({ status: 'PENDING' })
    const pending = await startBookingSession({ bookingId: b.id, byUserId: b.userId })
    expect(pending).toEqual({ ok: false, message: 'Sessions can only be logged on confirmed bookings.' })
    const confirmed = await seedBooking()
    const rando = await makeUser()
    const stranger = await startBookingSession({ bookingId: confirmed.id, byUserId: rando.id })
    expect(stranger).toEqual({ ok: false, message: 'You can only log sessions on your own bookings.' })
  })

  it('setSessionNote: gated before start; after start trims and caps at 1000; after end still writable', async () => {
    const b = await seedBooking()
    const before = await setSessionNote({ bookingId: b.id, byUserId: b.userId, note: 'too soon' })
    expect(before).toEqual({ ok: false, message: 'Notes can be added once the session has started.' })

    await startBookingSession({ bookingId: b.id, byUserId: b.userId })
    expect((await setSessionNote({ bookingId: b.id, byUserId: b.userId, note: '  padded  ' })).ok).toBe(true)
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).sessionNote).toBe('padded')

    await setSessionNote({ bookingId: b.id, byUserId: b.userId, note: 'x'.repeat(1500) })
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).sessionNote).toHaveLength(1000)

    await endBookingSession({ bookingId: b.id, byUserId: b.userId })
    expect((await setSessionNote({ bookingId: b.id, byUserId: b.userId, note: 'writeup after the fact' })).ok).toBe(true)
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).sessionNote).toBe('writeup after the fact')
  })

  it('missing booking degrades to the friendly not-found message', async () => {
    expect(await startBookingSession({ bookingId: 'nope', byUserId: 'anyone' })).toEqual({ ok: false, message: 'Booking not found.' })
    expect(await endBookingSession({ bookingId: 'nope', byUserId: 'anyone' })).toEqual({ ok: false, message: 'Booking not found.' })
    expect(await setSessionNote({ bookingId: 'nope', byUserId: 'anyone', note: 'x' })).toEqual({ ok: false, message: 'Booking not found.' })
  })
})
