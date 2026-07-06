import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../factories'
import { enqueueEmail, drainOutbox } from '@/lib/email/outbox'

describe('email outbox', () => {
  beforeEach(resetDb)

  it('sends queued email and marks SENT', async () => {
    await enqueueEmail('a@test.local', 'Hi', '<p>hi</p>')
    const send = vi.fn().mockResolvedValue(undefined)
    const n = await drainOutbox(send)
    expect(n).toBe(1)
    expect(send).toHaveBeenCalledWith({ to: 'a@test.local', subject: 'Hi', html: '<p>hi</p>' })
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe('SENT')
  })

  it('retries with backoff and never throws to the caller', async () => {
    await enqueueEmail('a@test.local', 'Hi', '<p>hi</p>')
    const send = vi.fn().mockRejectedValue(new Error('smtp down'))
    await drainOutbox(send)
    const row = await prisma.emailOutbox.findFirstOrThrow()
    expect(row.status).toBe('QUEUED')
    expect(row.attempts).toBe(1)
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
    expect(await drainOutbox(send)).toBe(0) // not due yet
  })

  it('marks FAILED after 8 attempts', async () => {
    await enqueueEmail('a@test.local', 'Hi', '<p>hi</p>')
    await prisma.emailOutbox.updateMany({ data: { attempts: 7, nextAttemptAt: new Date(Date.now() - 1000) } })
    await drainOutbox(vi.fn().mockRejectedValue(new Error('smtp down')))
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe('FAILED')
  })
})
