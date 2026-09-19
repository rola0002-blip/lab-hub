import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'
import { createBooking } from '@/features/booking/service'

beforeEach(() => resetDb())

async function seed() {
  const manager = await makeUser({ role: 'admin' })
  const eq = await makeEquipment()
  return { manager, eq }
}

describe('createMaintenanceWindow serialization', () => {
  it('cancels a booking that overlaps the window even when committed concurrently', async () => {
    const { manager, eq } = await seed()
    const user = await makeUser()
    // A booking racing the window creation (committed after the victims snapshot
    // would have run under the old code). With the advisory lock held by the
    // window tx, this create simply interleaves BEFORE the lock or AFTER the
    // cancel; assert the invariant both ways: after createMaintenanceWindow
    // confirms, NO PENDING/CONFIRMED booking overlaps the window.
    const win = { startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000) }
    await prisma.booking.create({ data: { userId: user.id, equipmentId: eq.id,
      startsAt: win.startsAt, endsAt: new Date(win.startsAt.getTime() + 3_600_000), purpose: 'p', status: 'CONFIRMED' } })
    const svc = await import('@/features/maintenance/service')
    const first = await svc.createMaintenanceWindow({ equipmentId: eq.id, startsAt: win.startsAt, endsAt: win.endsAt, reason: 'planned', byId: manager.id })
    expect(first.ok).toBe(false) // needs_confirmation with the conflict listed
    if (!first.ok && first.error === 'needs_confirmation') expect(first.conflicts.length).toBe(1)
    const second = await svc.createMaintenanceWindow({ equipmentId: eq.id, startsAt: win.startsAt, endsAt: win.endsAt, reason: 'planned', byId: manager.id, confirmCancel: true })
    expect(second.ok).toBe(true)
    const survivors = await prisma.booking.count({ where: { equipmentId: eq.id, status: { in: ['PENDING', 'CONFIRMED'] },
      startsAt: { lt: win.endsAt }, endsAt: { gt: win.startsAt } } })
    expect(survivors).toBe(0)
  })

  // The pure race is made deterministic by holding the advisory lock from a
  // side transaction: the victim booking commits only after the window
  // transaction is already queued on the lock, so the in-tx victim re-query
  // (not a pre-transaction snapshot) must see it.
  it('cancels a booking that commits while the window transaction waits on the lock', async () => {
    const { manager, eq } = await seed()
    const user = await makeUser()
    const win = { startsAt: hoursFromNow(24), endsAt: hoursFromNow(26) }
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${eq.id}, 0))`
      await tx.booking.create({ data: { userId: user.id, equipmentId: eq.id,
        startsAt: win.startsAt, endsAt: hoursFromNow(25), purpose: 'race', status: 'CONFIRMED' } })
      await new Promise((r) => setTimeout(r, 300))
    })
    const r = await import('@/features/maintenance/service').then((svc) =>
      svc.createMaintenanceWindow({ equipmentId: eq.id, startsAt: win.startsAt, endsAt: win.endsAt, reason: 'repair', byId: manager.id, confirmCancel: true }))
    await holder
    expect(r).toEqual({ ok: true })
    const survivors = await prisma.booking.count({ where: { equipmentId: eq.id, status: { in: ['PENDING', 'CONFIRMED'] },
      startsAt: { lt: win.endsAt }, endsAt: { gt: win.startsAt } } })
    expect(survivors).toBe(0)
  })

  // Mirror direction: the window commits while createBooking's transaction is
  // queued on the same lock. buildPolicyInput ran before the commit and saw
  // nothing — only the post-lock re-check inside the transaction can block it.
  it('blocks a booking whose slot lands in a window committed while it waits on the lock', async () => {
    const { eq } = await seed()
    const user = await makeUser()
    const slot = { startsAt: hoursFromNow(24), endsAt: hoursFromNow(25) }
    const holder = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${eq.id}, 0))`
      await tx.maintenanceWindow.create({ data: { equipmentId: eq.id,
        startsAt: slot.startsAt, endsAt: slot.endsAt, reason: 'pump service', createdById: user.id } })
      await new Promise((r) => setTimeout(r, 300))
    })
    const r = await createBooking({ userId: user.id, equipmentId: eq.id, purpose: 'p', startsAt: slot.startsAt, endsAt: slot.endsAt })
    await holder
    expect(r).toEqual({ ok: false, error: 'blocked', message: 'The requested time overlaps scheduled maintenance.' })
    expect(await prisma.booking.count({ where: { equipmentId: eq.id } })).toBe(0)
  })
})
