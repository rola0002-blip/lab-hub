import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Replace sendPush wholesale (the push-test-api.test.ts idiom) — notify() fires it
// without awaiting, but vi.fn records the call synchronously at invocation.
vi.mock('@/lib/push', () => ({ sendPush: vi.fn(async () => {}) }))

import { sendPush } from '@/lib/push'
import { resetDb, makeUser, seedSystem } from '../factories'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { _resetForTests } from '@/lib/events'
import { _resetActivityForTests, noteActivity } from '@/lib/activity'
import { _resetSquelchForTests } from '@/lib/push-squelch'
import { COLOSSUS_BOT_ID } from '@/features/bot/ids'

const push = vi.mocked(sendPush)

describe('notify → idle web push (W20-C)', () => {
  beforeEach(async () => {
    await resetDb()
    _resetActivityForTests(); _resetSquelchForTests(); push.mockClear()
  })
  afterEach(async () => { await _resetForTests() })

  it('pushes a non-chat row with the tray title, the message, the row href and a per-type tag', async () => {
    const u = await makeUser()
    await notify(u.id, 'issue_assigned', { message: 'Ada assigned you LAB-7', issueId: 'i1', identifier: 'LAB-7' })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith(u.id, {
      title: 'Issue assigned to you', body: 'Ada assigned you LAB-7', url: '/issues/LAB-7', tag: 'notif:issue_assigned',
    })
  })

  it('a booking reminder pushes to /bookings', async () => {
    const u = await makeUser()
    await notify(u.id, 'booking_reminder', { message: 'Upcoming: SEM 10:00–11:00 — you can log on now.' })
    expect(push).toHaveBeenCalledWith(u.id, expect.objectContaining({ title: 'Upcoming booking', url: '/bookings', tag: 'notif:booking_reminder' }))
  })

  it('never pushes a HUMAN chat row — fanout owns that push', async () => {
    const [u, other] = [await makeUser(), await makeUser()]
    await notify(u.id, 'message_dm', { message: 'x', conversationId: 'c1', messageId: 'm1', senderId: other.id })
    expect(push).not.toHaveBeenCalled()
  })

  it('pushes a BOT chat row (due-soon / overdue DM) — fanout never pushes bot senders', async () => {
    const u = await makeUser()
    await notify(u.id, 'message_dm', { message: 'LabHub Bot in a direct message: Heads up', conversationId: 'c1', messageId: 'm1', senderId: COLOSSUS_BOT_ID })
    expect(push).toHaveBeenCalledWith(u.id, expect.objectContaining({ title: 'New direct message', url: '/chat/c1?msg=m1', tag: 'notif:message_dm' }))
  })

  it('stays silent while the user is active (activity-gated, never connection-gated)', async () => {
    const u = await makeUser()
    noteActivity(u.id)
    await notify(u.id, 'training_request', { message: 'Noor requested training on XPS' })
    expect(push).not.toHaveBeenCalled()
  })

  it('one push per (user, type) per squelch window; a different type still pushes', async () => {
    const u = await makeUser()
    await notify(u.id, 'issue_comment', { message: 'a', identifier: 'LAB-1' })
    await notify(u.id, 'issue_comment', { message: 'b', identifier: 'LAB-2' })
    await notify(u.id, 'issue_done', { message: 'c', identifier: 'LAB-3' })
    expect(push.mock.calls.map((c) => c[1].tag)).toEqual(['notif:issue_comment', 'notif:issue_done'])
  })

  it('never pushes to a banned or system user (the row is still written)', async () => {
    const banned = await makeUser({ banned: true })
    await seedSystem()
    await notify(banned.id, 'issue_assigned', { message: 'x', identifier: 'LAB-1' })
    await notify(COLOSSUS_BOT_ID, 'issue_assigned', { message: 'x', identifier: 'LAB-1' })
    expect(push).not.toHaveBeenCalled()
    expect(await prisma.notification.count({ where: { userId: banned.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: COLOSSUS_BOT_ID } })).toBe(1)
  })

  it('a rejecting sendPush can never break notify', async () => {
    push.mockRejectedValueOnce(new Error('boom'))
    const u = await makeUser()
    await expect(notify(u.id, 'feedback_new', { message: 'New feedback from Ada', feedbackId: 'f1' })).resolves.toBeUndefined()
  })
})
