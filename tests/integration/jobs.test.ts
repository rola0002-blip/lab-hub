import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'
import { expirePendingBookings, sendBookingReminders, digestUnreadChat } from '@/lib/jobs'
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

  it('digestUnreadChat emails one digest per user, exactly once, excluding bot senders and fresh rows', async () => {
    const u1 = await makeUser(); const u2 = await makeUser()
    const sender = await makeUser()
    const bot = await prisma.user.upsert({ where: { id: 'colossus-bot' }, update: {}, create: { id: 'colossus-bot', name: 'LabHub Bot', email: 'bot@colossus.local', isSystem: true } })
    void bot
    const old = new Date(Date.now() - 2 * 3_600_000)
    const mk = async (userId: string, senderId: string, at: Date) => {
      const n = await prisma.notification.create({ data: { userId, type: 'message_dm', payload: { message: 'x', conversationId: 'c', messageId: 'm', senderId } } })
      await prisma.notification.update({ where: { id: n.id }, data: { createdAt: at } })
      return n.id
    }
    const a1 = await mk(u1.id, sender.id, old)
    await mk(u2.id, sender.id, old)
    await mk(u1.id, 'colossus-bot', old)       // bot sender → skipped
    await mk(u1.id, sender.id, new Date())     // fresh (<60min) → skipped
    const preWave = await prisma.notification.create({ data: { userId: u2.id, type: 'message_dm', payload: { message: 'old row', conversationId: 'c', messageId: 'm3' } } })
    await prisma.notification.update({ where: { id: preWave.id }, data: { createdAt: old } }) // no senderId (pre-wave) → skipped
    const emailed = await prisma.notification.create({ data: { userId: u1.id, type: 'message_dm', payload: { message: 'y', conversationId: 'c', messageId: 'm2', senderId: sender.id }, emailedAt: new Date() } })
    await prisma.notification.update({ where: { id: emailed.id }, data: { createdAt: old } }) // already emailed → skipped
    expect(await digestUnreadChat()).toBe(2)
    expect(await prisma.emailOutbox.count()).toBe(2)
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: a1 } })).emailedAt).not.toBeNull()
    expect(await digestUnreadChat()).toBe(0) // latched
  })
})
