import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'
import { deactivateUser, reactivateUser, setUserRole } from '@/features/people/service'
import { setManagers } from '@/features/equipment/service'

describe('people service', () => {
  beforeEach(resetDb)
  it('deactivate bans and deletes sessions; reactivate unbans', async () => {
    const u = await makeUser()
    await prisma.session.create({ data: { id: 's1', token: 't1', userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) } })
    await deactivateUser(u.id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).banned).toBe(true)
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0)
    await reactivateUser(u.id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).banned).toBe(false)
  })
  it('setUserRole updates role', async () => {
    const u = await makeUser({ role: 'guest' })
    await setUserRole(u.id, 'member')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('member')
  })
  it('deactivate cancels future bookings with reason and notifies managers in-app + email', async () => {
    const mgr = await makeUser({ role: 'member' })
    const u = await makeUser({ name: 'Jane Doe' })
    const eq = await makeEquipment()
    await setManagers(eq.id, [mgr.id])
    const b = await prisma.booking.create({ data: { equipmentId: eq.id, userId: u.id, status: 'CONFIRMED', purpose: 't', startsAt: hoursFromNow(24), endsAt: hoursFromNow(26) } })
    await deactivateUser(u.id)
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })
    expect(after.status).toBe('CANCELLED')
    expect(after.rejectionReason).toBe('User deactivated')
    expect(await prisma.notification.count({ where: { userId: mgr.id, type: 'booking_cancelled' } })).toBe(1)
    const email = await prisma.emailOutbox.findFirstOrThrow({ where: { toEmail: mgr.email } })
    expect(email.subject).toContain('cancelled')
  })
  it('leaves past and already-cancelled bookings untouched on deactivate', async () => {
    const mgr = await makeUser({ role: 'member' })
    const u = await makeUser()
    const eq = await makeEquipment()
    await setManagers(eq.id, [mgr.id])
    const past = await prisma.booking.create({ data: { equipmentId: eq.id, userId: u.id, status: 'CONFIRMED', purpose: 't', startsAt: hoursFromNow(-4), endsAt: hoursFromNow(-2) } })
    const cancelled = await prisma.booking.create({ data: { equipmentId: eq.id, userId: u.id, status: 'CANCELLED', purpose: 't', startsAt: hoursFromNow(24), endsAt: hoursFromNow(26) } })
    await deactivateUser(u.id)
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: past.id } })).status).toBe('CONFIRMED')
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: cancelled.id } })).rejectionReason).toBeNull()
    expect(await prisma.notification.count({ where: { userId: mgr.id, type: 'booking_cancelled' } })).toBe(0)
  })
})
