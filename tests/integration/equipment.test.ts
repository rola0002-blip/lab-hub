import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'
import { createEquipment, updateEquipment, setManagers, isManagerOf, retireEquipment } from '@/features/equipment/service'

describe('equipment service', () => {
  beforeEach(resetDb)

  it('creates with policy defaults and updates policy knobs', async () => {
    const eq = await createEquipment({ name: 'CVD Furnace', description: '', location: 'Lab A', advanceBookingDays: 14, maxDurationMinutes: 480, certificationRequired: true, approvalPolicy: 'GUESTS', allowRecurring: false })
    expect(eq.certificationRequired).toBe(true)
    const up = await updateEquipment(eq.id, { maxDurationMinutes: 240 })
    expect(up.maxDurationMinutes).toBe(240)
  })

  it('manages the manager set and role-aware isManagerOf', async () => {
    const eq = await makeEquipment()
    const member = await makeUser({ role: 'member' })
    const admin = await makeUser({ role: 'admin' })
    await setManagers(eq.id, [member.id])
    expect(await isManagerOf(member.id, eq.id)).toBe(true)
    expect(await isManagerOf(admin.id, eq.id)).toBe(true) // admins manage everything
    await setManagers(eq.id, [])
    expect(await isManagerOf(member.id, eq.id)).toBe(false)
  })

  it('retire cancels future slot-holding bookings and notifies owners', async () => {
    const eq = await makeEquipment()
    const u = await makeUser()
    await prisma.booking.create({ data: { equipmentId: eq.id, userId: u.id, status: 'CONFIRMED', purpose: 't', startsAt: hoursFromNow(24), endsAt: hoursFromNow(26) } })
    await prisma.booking.create({ data: { equipmentId: eq.id, userId: u.id, status: 'CANCELLED', purpose: 't', startsAt: hoursFromNow(48), endsAt: hoursFromNow(50) } })
    const { cancelled } = await retireEquipment(eq.id)
    expect(cancelled).toBe(1)
    expect((await prisma.equipment.findUniqueOrThrow({ where: { id: eq.id } })).status).toBe('RETIRED')
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'booking_cancelled' } })).toBe(1)
  })
})
