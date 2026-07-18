import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow, seedSystem } from '../factories'
import { LAB_UPDATES_CHANNEL_ID, COLOSSUS_BOT_ID } from '@/features/bot'
import { createIssue, setStatus } from '@/features/issues/issue-service'
import { createProject } from '@/features/issues/project-service'
import { createBooking, decideBooking } from '@/features/booking/service'
import { setManagers } from '@/features/equipment/service'
import { fanoutMessage } from '@/features/chat/fanout'

// Wrap the REAL fanout in a spy (Task 8 idiom). A suppressed bot DM must never
// dispatch fan-out; the CALL is synchronous, so `not.toHaveBeenCalled()` is a
// discriminating check (a broken suppression guard fails deterministically, even
// though fanout's own DB writes would land later). Wrapping the real impl keeps
// announces working — an announce IS a normal send, so fanout still runs.
vi.mock('@/features/chat/fanout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat/fanout')>()
  return { ...actual, fanoutMessage: vi.fn(actual.fanoutMessage) }
})
const fanoutSpy = vi.mocked(fanoutMessage)

// Channel announces are fire-and-forget (`void bot.announceToChannel`) so they never
// block or reorder the host mutation; their rows land a few DB round-trips after the
// mutation resolves. Poll for them rather than read synchronously.
const until = async (fn: () => Promise<boolean>, ms = 2000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)) }
}

const channelText = async () =>
  (await prisma.message.findMany({ where: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: COLOSSUS_BOT_ID }, orderBy: { createdAt: 'asc' } })).map((m) => m.body)

// Count bot-authored messages in the DM the bot shares with `userId`.
const botDmCount = (userId: string) =>
  prisma.message.count({ where: { userId: COLOSSUS_BOT_ID, conversation: { type: 'DM', members: { some: { userId } } } } })

describe('bot triggers', () => {
  beforeEach(async () => { await resetDb(); await seedSystem(); fanoutSpy.mockClear() })

  it('announces a new project and a new issue in #lab-updates', async () => {
    const u = await makeUser({ role: 'member' })
    await createProject({ actorId: u.id, role: 'member', name: 'hBN scale-up' })
    const i = await createIssue({ actorId: u.id, role: 'member', title: 'calibrate furnace' })
    await until(async () => {
      const l = await channelText()
      return l.some((x) => x.includes('hBN scale-up')) && l.some((x) => x.includes(i.identifier))
    })
    const lines = await channelText()
    expect(lines.some((l) => l.includes('hBN scale-up'))).toBe(true)
    expect(lines.some((l) => l.includes(i.identifier))).toBe(true) // LAB-<n> auto-links in the client
  })

  it('announces only when an issue REACHES done (not on other status changes)', async () => {
    const u = await makeUser({ role: 'member' })
    const i = await createIssue({ actorId: u.id, role: 'member', title: 'x' })
    await until(async () => (await channelText()).some((l) => l.includes(i.identifier))) // create announce settles
    await setStatus({ actorId: u.id, role: 'member', issueId: i.id, status: 'IN_PROGRESS' })
    let lines = await channelText()
    const doneBefore = lines.filter((l) => l.toLowerCase().includes('done')).length
    await setStatus({ actorId: u.id, role: 'member', issueId: i.id, status: 'DONE' })
    await until(async () => (await channelText()).some((l) => l.toLowerCase().includes('done')))
    lines = await channelText()
    expect(lines.filter((l) => l.toLowerCase().includes('done')).length).toBe(doneBefore + 1)
  })

  it('booking pending DMs managers/admins silently (one-bell), never the booker', async () => {
    const g = await makeUser({ role: 'guest' })
    const mgr = await makeUser({ role: 'member' })
    const eq = await makeEquipment()
    await setManagers(eq.id, [mgr.id])
    fanoutSpy.mockClear()
    const r = await createBooking({ userId: g.id, equipmentId: eq.id, purpose: 'x', startsAt: hoursFromNow(24), endsAt: hoursFromNow(28) })
    expect(r).toMatchObject({ ok: true, pending: true })
    // Suppressed DMs never dispatch fan-out (discriminating: a broken guard calls it synchronously).
    expect(fanoutSpy).not.toHaveBeenCalled()
    // Manager: native booking_pending bell is the single ping; the bot DM row is silent (no message_dm).
    expect(await prisma.notification.count({ where: { userId: mgr.id, type: 'booking_pending' } })).toBe(1)
    expect(await botDmCount(mgr.id)).toBe(1)
    expect(await prisma.notification.count({ where: { userId: mgr.id, type: 'message_dm' } })).toBe(0)
    // Recipients exactly match notifyManagersOfPending's set: the booker is NOT DMed on pending.
    expect(await botDmCount(g.id)).toBe(0)
  })

  it('booking decided DMs the booker silently (one-bell)', async () => {
    const g = await makeUser({ role: 'guest' })
    const mgr = await makeUser({ role: 'member' })
    const eq = await makeEquipment()
    await setManagers(eq.id, [mgr.id])
    await createBooking({ userId: g.id, equipmentId: eq.id, purpose: 'x', startsAt: hoursFromNow(24), endsAt: hoursFromNow(28) })
    const b = await prisma.booking.findFirstOrThrow()
    fanoutSpy.mockClear()
    const res = await decideBooking({ bookingId: b.id, deciderId: mgr.id, decision: 'approve' })
    expect(res.ok).toBe(true)
    expect(fanoutSpy).not.toHaveBeenCalled() // suppressed decided DM → no fan-out
    // Booker: native booking_decided bell is the single ping; the bot DM row is silent.
    expect(await prisma.notification.count({ where: { userId: g.id, type: 'booking_decided' } })).toBe(1)
    expect(await botDmCount(g.id)).toBe(1)
    expect(await prisma.notification.count({ where: { userId: g.id, type: 'message_dm' } })).toBe(0)
  })
})
