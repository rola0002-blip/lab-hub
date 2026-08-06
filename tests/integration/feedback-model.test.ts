import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeFeedback } from '../factories'

describe('Feedback model (v0.13 §4.1)', () => {
  beforeEach(resetDb)

  it('persists a submission: status defaults to NEW, both timestamps set, screenshot optional', async () => {
    const u = await makeUser()
    const fb = await makeFeedback({ authorId: u.id })
    expect(fb).toMatchObject({
      authorId: u.id,
      type: 'BUG',
      status: 'NEW',
      body: 'Test feedback',
      pagePath: '/dashboard',
      appVersion: '0.0.0-test',
      userAgent: 'test-agent',
    })
    expect(fb.screenshotPath).toBeNull()
    expect(fb.createdAt).toBeInstanceOf(Date)
    expect(fb.updatedAt).toBeInstanceOf(Date)
    expect(await prisma.feedback.findUniqueOrThrow({ where: { id: fb.id } })).toEqual(fb)

    const idea = await makeFeedback({ authorId: u.id, type: 'IDEA', status: 'PLANNED', screenshotPath: '/uploads/feedback/abc.png' })
    expect(idea).toMatchObject({ type: 'IDEA', status: 'PLANNED', screenshotPath: '/uploads/feedback/abc.png' })
  })

  it('restricts deleting the author; the feedback row itself deletes', async () => {
    const u = await makeUser()
    const fb = await makeFeedback({ authorId: u.id })
    await expect(prisma.user.delete({ where: { id: u.id } })).rejects.toThrow() // Restrict — fails loudly
    await prisma.feedback.delete({ where: { id: fb.id } })
    expect(await prisma.feedback.count()).toBe(0)
  })

  it('resetDb truncates the new table', async () => {
    const u = await makeUser()
    await makeFeedback({ authorId: u.id })
    expect(await prisma.feedback.count()).toBe(1)
    await resetDb()
    expect(await prisma.feedback.count()).toBe(0)
  })
})
