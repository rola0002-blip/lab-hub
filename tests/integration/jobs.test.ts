import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'
import { expirePendingBookings, sendBookingReminders, digestUnreadChat, BOOKING_REMINDER_LEAD_MS } from '@/lib/jobs'
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

  it('reminds once, inside the 15-minute log-on window, and says log-on is open', async () => {
    expect(BOOKING_REMINDER_LEAD_MS).toBe(15 * 60_000) // == SESSION_EARLY_MS: remind when log-on opens
    const u = await makeUser()
    const eq = await makeEquipment()
    const eq2 = await makeEquipment() // booking_no_overlap covers CONFIRMED: the 30-min row overlaps the 10-min one
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, purpose: 'x', status: 'CONFIRMED', startsAt: new Date(Date.now() + 10 * 60_000), endsAt: hoursFromNow(3) } })
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq2.id, purpose: 'later', status: 'CONFIRMED', startsAt: new Date(Date.now() + 30 * 60_000), endsAt: hoursFromNow(4) } })
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, purpose: 'far', status: 'CONFIRMED', startsAt: hoursFromNow(5), endsAt: hoursFromNow(6) } })
    expect(await sendBookingReminders()).toBe(1)
    expect(await sendBookingReminders()).toBe(0) // reminderSentAt set — no double send
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: u.id, type: 'booking_reminder' } })
    expect((n.payload as { message: string }).message).toMatch(/— you can log on now\.$/)
    expect(await prisma.emailOutbox.count()).toBe(1)
  })

  it('a booking 30 min out is reminded only once it enters the window', async () => {
    const u = await makeUser()
    const eq = await makeEquipment()
    const now = new Date()
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, purpose: 'x', status: 'CONFIRMED', startsAt: new Date(+now + 30 * 60_000), endsAt: new Date(+now + 90 * 60_000) } })
    expect(await sendBookingReminders(now)).toBe(0)
    expect(await sendBookingReminders(new Date(+now + 16 * 60_000))).toBe(1) // 14 min before start
  })

  it('digestUnreadChat emails one digest per user, exactly once, excluding bot senders and fresh rows', async () => {
    const u1 = await makeUser(); const u2 = await makeUser()
    const sender = await makeUser()
    await prisma.user.upsert({ where: { id: 'colossus-bot' }, update: {}, create: { id: 'colossus-bot', name: 'LabHub Bot', email: 'bot@colossus.local', isSystem: true } })
    const old = new Date(Date.now() - 2 * 3_600_000)
    const mk = async (userId: string, senderId: string, at: Date) => {
      const n = await prisma.notification.create({ data: { userId, type: 'message_dm', payload: { message: 'x', conversationId: 'c', messageId: 'm', senderId } } })
      await prisma.notification.update({ where: { id: n.id }, data: { createdAt: at } })
      return n.id
    }
    const a1 = await mk(u1.id, sender.id, old)
    await mk(u2.id, sender.id, old)
    await mk(u1.id, 'colossus-bot', old)       // bot sender → skipped
    const freshId = await mk(u1.id, sender.id, new Date()) // fresh (<60min) → skipped
    const preWave = await prisma.notification.create({ data: { userId: u2.id, type: 'message_dm', payload: { message: 'old row', conversationId: 'c', messageId: 'm3' } } })
    await prisma.notification.update({ where: { id: preWave.id }, data: { createdAt: old } }) // no senderId (pre-wave) → skipped
    const emailed = await prisma.notification.create({ data: { userId: u1.id, type: 'message_dm', payload: { message: 'y', conversationId: 'c', messageId: 'm2', senderId: sender.id }, emailedAt: old } })
    await prisma.notification.update({ where: { id: emailed.id }, data: { createdAt: old } }) // already emailed → skipped (emailedAt aged so it does not trip u1's cooldown)
    expect(await digestUnreadChat()).toBe(2)
    expect(await prisma.emailOutbox.count()).toBe(2)
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: a1 } })).emailedAt).not.toBeNull()
    // Starvation fix: rows that were scanned but found permanently ineligible (bot
    // sender / no senderId) are stamped emailedAt so they EXIT future scans —
    // previously they were re-fetched every 300s tick forever, and a set made
    // entirely of them returned early without latching anything. Only the fresh
    // (<60-min, unscanned) row keeps emailedAt null.
    expect((await prisma.notification.findMany({ where: { emailedAt: null }, select: { id: true } })).map((r) => r.id)).toEqual([freshId])
    expect(await digestUnreadChat()).toBe(0) // latched
    // Per-user cooldown: a NEW old unread row for u1 must not digest — u1 was
    // just emailed (emailedAt stamped moments ago by the run above).
    const another = await mk(u1.id, sender.id, old)
    expect(await digestUnreadChat()).toBe(0)
    // Age u1's cooldown (her latched row's emailedAt → 2h ago): the row digests.
    await prisma.notification.update({ where: { id: a1 }, data: { emailedAt: old } })
    expect(await digestUnreadChat()).toBe(1)
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: another } })).emailedAt).not.toBeNull()
  })
})
