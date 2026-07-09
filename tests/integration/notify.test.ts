import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { notify } from '@/lib/notify'
import { subscribe, _resetForTests, type LabEvent } from '@/lib/events'

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
  })
})
