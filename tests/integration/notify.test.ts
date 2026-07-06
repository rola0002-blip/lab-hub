import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { notify } from '@/lib/notify'

describe('notify', () => {
  beforeEach(resetDb)
  it('creates a notification and optional email', async () => {
    const u = await makeUser()
    await notify(u.id, 'booking_decided', { bookingId: 'b1' }, { subject: 'S', html: '<p>H</p>' })
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'booking_decided' } })).toBe(1)
    expect((await prisma.emailOutbox.findFirstOrThrow()).toEmail).toBe(u.email)
  })
  it('never throws for a missing user', async () => {
    await expect(notify('nope', 'booking_decided', {})).resolves.toBeUndefined()
  })
})
