import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'
import { createMaintenanceWindow, deleteMaintenanceWindow } from '@/features/maintenance/service'
import { setManagers } from '@/features/equipment/service'
import { createBooking } from '@/features/booking/service'

describe('maintenance windows', () => {
  beforeEach(resetDb)

  it('manager creates a window when there are no conflicts', async () => {
    const mgr = await makeUser({ role: 'member' })
    const eq = await makeEquipment()
    await setManagers(eq.id, [mgr.id])
    const r = await createMaintenanceWindow({ equipmentId: eq.id, startsAt: hoursFromNow(24), endsAt: hoursFromNow(30), reason: 'gas change', byId: mgr.id })
    expect(r).toEqual({ ok: true })
    expect(await prisma.maintenanceWindow.count()).toBe(1)
  })

  it('non-manager is forbidden', async () => {
    const rando = await makeUser()
    const eq = await makeEquipment()
    const r = await createMaintenanceWindow({ equipmentId: eq.id, startsAt: hoursFromNow(24), endsAt: hoursFromNow(30), reason: 'x', byId: rando.id })
    expect(r).toMatchObject({ ok: false, error: 'forbidden' })
  })

  it('requires confirmation when bookings overlap, then cancels and notifies on confirm', async () => {
    const admin = await makeUser({ role: 'admin' })
    const u = await makeUser()
    const eq = await makeEquipment()
    await createBooking({ userId: u.id, equipmentId: eq.id, purpose: 'x', startsAt: hoursFromNow(25), endsAt: hoursFromNow(27) })
    const first = await createMaintenanceWindow({ equipmentId: eq.id, startsAt: hoursFromNow(24), endsAt: hoursFromNow(30), reason: 'repair', byId: admin.id })
    expect(first).toMatchObject({ ok: false, error: 'needs_confirmation' })
    if (first.ok !== false || first.error !== 'needs_confirmation') return
    expect(first.conflicts).toHaveLength(1)
    const second = await createMaintenanceWindow({ equipmentId: eq.id, startsAt: hoursFromNow(24), endsAt: hoursFromNow(30), reason: 'repair', byId: admin.id, confirmCancel: true })
    expect(second).toEqual({ ok: true })
    expect((await prisma.booking.findFirstOrThrow()).status).toBe('CANCELLED')
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'booking_cancelled_maintenance' } })).toBe(1)
  })

  it('delete removes the window (manager only)', async () => {
    const admin = await makeUser({ role: 'admin' })
    const eq = await makeEquipment()
    await createMaintenanceWindow({ equipmentId: eq.id, startsAt: hoursFromNow(24), endsAt: hoursFromNow(30), reason: 'x', byId: admin.id })
    const w = await prisma.maintenanceWindow.findFirstOrThrow()
    expect((await deleteMaintenanceWindow(w.id, admin.id)).ok).toBe(true)
    expect(await prisma.maintenanceWindow.count()).toBe(0)
  })
})
