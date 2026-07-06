import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'
import { expirePendingBookings, sendBookingReminders } from '@/lib/jobs'
import { setManagers } from '@/features/equipment/service'

describe('scheduler jobs', () => {
  beforeEach(resetDb)

  it('expires overdue PENDING bookings and notifies requester + managers', async () => {
    const u = await makeUser()
    const mgr = await makeUser({ role: 'member' })
    const eq = await makeEquipment()
    await setManagers(eq.id, [mgr.id])
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, purpose: 'x', status: 'PENDING', startsAt: hoursFromNow(-1), endsAt: hoursFromNow(1) } })
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, purpose: 'y', status: 'PENDING', startsAt: hoursFromNow(5), endsAt: hoursFromNow(6) } })
    const n = await expirePendingBookings()
    expect(n).toBe(1)
    expect(await prisma.booking.count({ where: { status: 'EXPIRED' } })).toBe(1)
    expect(await prisma.booking.count({ where: { status: 'PENDING' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'booking_expired' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: mgr.id, type: 'booking_expired' } })).toBe(1)
  })

  it('sends one reminder inside the 60-minute window, exactly once', async () => {
    const u = await makeUser()
    const eq = await makeEquipment()
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, purpose: 'x', status: 'CONFIRMED', startsAt: new Date(Date.now() + 30 * 60_000), endsAt: hoursFromNow(3) } })
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, purpose: 'far', status: 'CONFIRMED', startsAt: hoursFromNow(5), endsAt: hoursFromNow(6) } })
    expect(await sendBookingReminders()).toBe(1)
    expect(await sendBookingReminders()).toBe(0) // reminderSentAt set — no double send
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'booking_reminder' } })).toBe(1)
    expect(await prisma.emailOutbox.count()).toBe(1)
  })
})
