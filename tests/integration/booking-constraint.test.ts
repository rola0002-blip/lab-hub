import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'

describe('booking_no_overlap exclusion constraint', () => {
  beforeEach(resetDb)

  it('rejects overlapping CONFIRMED bookings on the same equipment at the DB level', async () => {
    const u = await makeUser()
    const eq = await makeEquipment()
    const base = { userId: u.id, equipmentId: eq.id, purpose: 't', status: 'CONFIRMED' as const }
    await prisma.booking.create({ data: { ...base, startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) } })
    await expect(
      prisma.booking.create({ data: { ...base, startsAt: hoursFromNow(2), endsAt: hoursFromNow(4) } }),
    ).rejects.toThrow(/booking_no_overlap/)
  })

  it('rejects a PENDING booking overlapping a CONFIRMED one, and CONFIRMED over PENDING (both statuses covered)', async () => {
    const u = await makeUser()
    const eqA = await makeEquipment()
    const eqB = await makeEquipment()
    // PENDING inserted over an existing CONFIRMED booking
    const baseA = { userId: u.id, equipmentId: eqA.id, purpose: 't' }
    await prisma.booking.create({ data: { ...baseA, status: 'CONFIRMED', startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) } })
    await expect(
      prisma.booking.create({ data: { ...baseA, status: 'PENDING', startsAt: hoursFromNow(2), endsAt: hoursFromNow(4) } }),
    ).rejects.toThrow(/booking_no_overlap/)
    // reverse: CONFIRMED inserted over an existing PENDING booking (distinct equipment for a clean slate)
    const baseB = { userId: u.id, equipmentId: eqB.id, purpose: 't' }
    await prisma.booking.create({ data: { ...baseB, status: 'PENDING', startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) } })
    await expect(
      prisma.booking.create({ data: { ...baseB, status: 'CONFIRMED', startsAt: hoursFromNow(2), endsAt: hoursFromNow(4) } }),
    ).rejects.toThrow(/booking_no_overlap/)
  })

  it('allows overlap when one booking is CANCELLED, and on different equipment', async () => {
    const u = await makeUser()
    const eq1 = await makeEquipment()
    const eq2 = await makeEquipment()
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq1.id, purpose: 't', status: 'CANCELLED', startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) } })
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq1.id, purpose: 't', status: 'CONFIRMED', startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) } })
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq2.id, purpose: 't', status: 'CONFIRMED', startsAt: hoursFromNow(1), endsAt: hoursFromNow(3) } })
    expect(await prisma.booking.count()).toBe(3)
  })
})
