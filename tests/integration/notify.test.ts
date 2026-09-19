import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { notify } from '@/lib/notify'
import { subscribe, _resetForTests, type LabEvent } from '@/lib/events'

// Wrap (not replace) enqueueEmail so the ordering test below can reject it once;
// every other use falls through to the real implementation (the fanout-mock idiom).
vi.mock('@/lib/email/outbox', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/email/outbox')>()
  return { ...orig, enqueueEmail: vi.fn(orig.enqueueEmail) }
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
function collector() {
  const events: LabEvent[] = []
  return { events, send: (e: LabEvent) => events.push(e) }
}

describe('notify', () => {
  beforeEach(resetDb)
  afterEach(async () => { await _resetForTests() })

  it('creates a notification and optional email', async () => {
    const u = await makeUser()
    await notify(u.id, 'booking_decided', { bookingId: 'b1' }, { subject: 'S', html: '<p>H</p>' })
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'booking_decided' } })).toBe(1)
    expect((await prisma.emailOutbox.findFirstOrThrow()).toEmail).toBe(u.email)
    // The email path latches emailedAt (exempts the row from the 60-min digest).
    expect((await prisma.notification.findFirstOrThrow()).emailedAt).not.toBeNull()
  })
  it('never throws for a missing user', async () => {
    await expect(notify('nope', 'booking_decided', {})).resolves.toBeUndefined()
  })
  it('emits a live {t:notif} event to the target user (bell upgrades to instant)', async () => {
    const u = await makeUser()
    const c = collector()
    subscribe({ userId: u.id, conversationIds: new Set(), reload: async () => new Set(), send: c.send })
    await wait(300) // listener connects
    await notify(u.id, 'message_mention', { messageId: 'm1' })
    await wait(300)
    expect(c.events).toContainEqual({ t: 'notif', uid: u.id })
    // Bell-only (no email arg): the row stays digest-eligible — no emailedAt.
    expect((await prisma.notification.findFirstOrThrow()).emailedAt).toBeNull()
  })
  it('latches emailedAt only AFTER the email enqueues — a failed enqueue leaves the row digest-eligible', async () => {
    const u = await makeUser()
    const { enqueueEmail } = await import('@/lib/email/outbox')
    vi.mocked(enqueueEmail).mockRejectedValueOnce(new Error('boom'))
    await notify(u.id, 'booking_decided', { bookingId: 'b1' }, { subject: 'S', html: '<p>H</p>' })
    const row = await prisma.notification.findFirstOrThrow()
    // Pre-fix the create stamped emailedAt up front, so a crash between the row
    // insert and the enqueue silently swallowed the notification's digest slot.
    expect(row.emailedAt).toBeNull()
  })
})
