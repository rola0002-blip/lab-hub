import path from 'node:path'
import os from 'node:os'
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises'

// Confine screenshot writes to a throwaway dir so the suite leaves the repo tree
// clean. uploadsDir() reads UPLOADS_DIR lazily per call, so setting it here (before
// the service module imports) is enough — the issue-routes.test.ts idiom.
const UPLOAD_DIR = path.join(os.tmpdir(), 'labhub-feedback-service-uploads')
process.env.UPLOADS_DIR = UPLOAD_DIR

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeFeedback } from '../factories'
import type { SessionUser } from '@/lib/session'
import { PolicyError, type FeedbackStatus } from '@/features/feedback/feedback-policy'
import { resetFeedbackRate, FEEDBACK_RATE_MAX } from '@/features/feedback/rate-limit'
import {
  submitFeedback, listMyFeedback, listAllFeedback, setFeedbackStatus, deleteFeedback,
  type SubmitFeedbackInput,
} from '@/features/feedback/feedback-service'

const FEEDBACK_UPLOADS = path.join(UPLOAD_DIR, 'feedback')

const su = (u: { id: string; name: string; email: string; role: string }): SessionUser =>
  ({ id: u.id, name: u.name, email: u.email, role: u.role as SessionUser['role'] })

const input = (over: Partial<SubmitFeedbackInput> = {}): SubmitFeedbackInput => ({
  type: 'BUG',
  body: 'The booking grid drops taps on iPhone.',
  pagePath: '/booking',
  appVersion: '0.13.0-test',
  userAgent: 'Mozilla/5.0 (iPhone)',
  ...over,
})

// Unwrap the hybrid return so the happy paths read straight (the limiter arm is
// exercised explicitly by its own test).
async function submitOk(user: SessionUser, over: Partial<SubmitFeedbackInput> = {}) {
  const res = await submitFeedback(user, input(over))
  if (!res.ok) throw new Error(`expected a successful submit, got ${res.error}`)
  return res.feedback
}

const bells = (userId?: string) =>
  prisma.notification.findMany({ where: userId ? { userId } : {}, orderBy: { createdAt: 'asc' } })

const payloadOf = (n: { payload: unknown }) => n.payload as Record<string, string>

// Distinct, ordered createdAt stamps: `createdAt` alone is not a total order (two
// inserts can share a millisecond), so ordering assertions stamp explicitly.
const stampAt = (id: string, iso: string) =>
  prisma.feedback.update({ where: { id }, data: { createdAt: new Date(iso) } })

describe('feedback-service', () => {
  beforeEach(async () => {
    await resetDb()
    resetFeedbackRate()
    await rm(FEEDBACK_UPLOADS, { recursive: true, force: true })
  })
  afterAll(async () => { await rm(UPLOAD_DIR, { recursive: true, force: true }) })

  it('submitFeedback stores the row with the server-stamped context, NEW status and an ISO createdAt', async () => {
    const m = await makeUser({ role: 'member', name: 'Roland' })
    const dto = await submitOk(su(m), { body: '   Taps get dropped.   ', type: 'IDEA' })
    expect(dto.body).toBe('Taps get dropped.')          // trimmed
    expect(dto.type).toBe('IDEA')
    expect(dto.status).toBe('NEW')                       // schema default
    expect(dto.screenshotPath).toBeNull()
    expect(dto.appVersion).toBe('0.13.0-test')
    expect(dto.pagePath).toBe('/booking')
    expect(dto.userAgent).toBe('Mozilla/5.0 (iPhone)')
    expect(dto.author).toEqual({ id: m.id, name: 'Roland', image: null })
    expect(dto.createdAt).toBe(new Date(dto.createdAt).toISOString()) // ISO string, MessageDto convention
    const row = await prisma.feedback.findUniqueOrThrow({ where: { id: dto.id } })
    expect(row.authorId).toBe(m.id)
    expect(row.status).toBe('NEW')
  })

  it('caps the body and slices the untrusted pagePath / userAgent to 300', async () => {
    const m = await makeUser({ role: 'member' })
    await expect(submitFeedback(su(m), input({ body: 'x'.repeat(4001) }))).rejects.toThrow(PolicyError)
    await expect(submitFeedback(su(m), input({ body: '   ' }))).rejects.toThrow(PolicyError)
    await expect(submitFeedback(su(m), input({ body: '' }))).rejects.toMatchObject({ code: 'invalid' })
    // The limiter runs BEFORE validation (spec §6.2 order), so each of those three
    // rejected submits still consumed a token — a flood of invalid bodies is throttled
    // too. Hence the successful cases below use a fresh user.
    const m2 = await makeUser({ role: 'member' })
    const long = await submitOk(su(m2), { pagePath: '/issues?q=' + 'y'.repeat(400), userAgent: 'u'.repeat(400) })
    expect(long.pagePath.length).toBe(300)
    expect(long.userAgent.length).toBe(300)
    // Origin-bearing paths never start with '/' → normalized away entirely (Task 2).
    const origin = await submitOk(su(m2), { pagePath: 'https://evil.example/steal' })
    expect(origin.pagePath).toBe('/')
    // 4000 exactly is legal — the cap is inclusive.
    expect((await submitOk(su(m2), { body: 'z'.repeat(4000) })).body.length).toBe(4000)
  })

  it('lets a guest submit (the deliberate divergence from the issue composer)', async () => {
    const g = await makeUser({ role: 'guest' })
    const dto = await submitOk(su(g))
    expect(dto.author.id).toBe(g.id)
    expect(await prisma.feedback.count()).toBe(1)
  })

  it('accepts a screenshot only under /uploads/feedback/ (cross-feature IDOR guard)', async () => {
    const m = await makeUser({ role: 'member' })
    await expect(submitFeedback(su(m), input({ screenshotPath: '/uploads/documents/x.png' }))).rejects.toThrow(PolicyError)
    await expect(submitFeedback(su(m), input({ screenshotPath: '/uploads/feedback/../documents/x.png' }))).rejects.toMatchObject({ code: 'invalid' })
    expect(await prisma.feedback.count()).toBe(0)
    const dto = await submitOk(su(m), { screenshotPath: '/uploads/feedback/shot.png' })
    expect(dto.screenshotPath).toBe('/uploads/feedback/shot.png')
  })

  it('returns the rate_limited result object (never a throw) once the window is full', async () => {
    const m = await makeUser({ role: 'member' })
    for (let i = 0; i < FEEDBACK_RATE_MAX; i++) expect((await submitFeedback(su(m), input())).ok).toBe(true)
    const res = await submitFeedback(su(m), input())
    expect(res).toEqual({ ok: false, error: 'rate_limited' })
    expect(await prisma.feedback.count()).toBe(FEEDBACK_RATE_MAX) // nothing persisted
    // Per-user window: someone else is unaffected.
    const other = await makeUser({ role: 'member' })
    expect((await submitFeedback(su(other), input())).ok).toBe(true)
  })

  it('bells every OTHER admin — never the author, members, guests, banned or system rows', async () => {
    const a1 = await makeUser({ role: 'admin', name: 'Admin One' })
    const a2 = await makeUser({ role: 'admin', name: 'Admin Two' })
    await makeUser({ role: 'member' })
    await makeUser({ role: 'guest' })
    await makeUser({ role: 'admin', banned: true })
    // An admin-roled system row: the bot itself is member-roled, so this synthetic
    // row is what actually exercises the isSystem:false arm of the fan-out filter.
    await prisma.user.create({
      data: { id: randomUUID(), name: 'System Admin', email: `${randomUUID().slice(0, 12)}@test.local`, emailVerified: true, role: 'admin', isSystem: true },
    })
    const m = await makeUser({ role: 'member', name: 'Roland' })

    const dto = await submitOk(su(m))
    const rows = await bells()
    expect(rows.length).toBe(2)
    expect(rows.every((n) => n.type === 'feedback_new')).toBe(true)
    expect(rows.map((n) => n.userId).sort()).toEqual([a1.id, a2.id].sort())
    expect(payloadOf(rows[0])).toEqual({ feedbackId: dto.id, message: 'New feedback from Roland' })
    // No email is ever queued by this feature — every notify() call is three-arg.
    expect(await prisma.emailOutbox.count()).toBe(0)

    // An admin's own submit bells only the OTHER admin.
    await submitOk(su(a1))
    expect((await bells(a1.id)).length).toBe(1)   // still just the member's submission
    expect((await bells(a2.id)).length).toBe(2)
  })

  it('listMyFeedback returns only the caller rows, newest first', async () => {
    const m = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })
    const older = await makeFeedback({ authorId: m.id, body: 'older' })
    const newer = await makeFeedback({ authorId: m.id, body: 'newer' })
    await makeFeedback({ authorId: other.id, body: 'theirs' })
    await stampAt(older.id, '2026-08-01T00:00:00.000Z')
    await stampAt(newer.id, '2026-08-05T00:00:00.000Z')
    const mine = await listMyFeedback(su(m))
    expect(mine.map((f) => f.body)).toEqual(['newer', 'older'])
    expect((await listMyFeedback(su(other))).map((f) => f.body)).toEqual(['theirs'])
  })

  it('listAllFeedback is admin-only and unpaginated, newest first', async () => {
    const admin = await makeUser({ role: 'admin' })
    const m = await makeUser({ role: 'member' })
    const g = await makeUser({ role: 'guest' })
    const a = await makeFeedback({ authorId: m.id, body: 'from member' })
    const b = await makeFeedback({ authorId: g.id, body: 'from guest' })
    await stampAt(a.id, '2026-08-01T00:00:00.000Z')
    await stampAt(b.id, '2026-08-05T00:00:00.000Z')
    await expect(listAllFeedback(su(m))).rejects.toMatchObject({ code: 'forbidden' })
    await expect(listAllFeedback(su(g))).rejects.toThrow(PolicyError)
    const all = await listAllFeedback(su(admin))
    expect(all.map((f) => f.body)).toEqual(['from guest', 'from member'])
    expect(all[0].author.id).toBe(g.id)
  })

  it('setFeedbackStatus: decisions bell the author exactly once; REVIEWED and no-op writes never bell', async () => {
    const admin = await makeUser({ role: 'admin' })
    const m = await makeUser({ role: 'member' })
    const fb = await makeFeedback({ authorId: m.id })

    const reviewed = await setFeedbackStatus(su(admin), fb.id, 'REVIEWED')
    expect(reviewed.status).toBe('REVIEWED')
    expect(await prisma.notification.count({ where: { userId: m.id } })).toBe(0) // bookkeeping, not a decision

    const planned = await setFeedbackStatus(su(admin), fb.id, 'PLANNED')
    expect(planned.status).toBe('PLANNED')
    const rows = await bells(m.id)
    expect(rows.length).toBe(1)
    expect(rows[0].type).toBe('feedback_decided')
    expect(payloadOf(rows[0])).toEqual({ feedbackId: fb.id, status: 'PLANNED', message: 'Your feedback was marked Planned' })

    // Idempotent re-write: no second bell AND no write at all (updatedAt is untouched).
    const before = await prisma.feedback.findUniqueOrThrow({ where: { id: fb.id } })
    const again = await setFeedbackStatus(su(admin), fb.id, 'PLANNED')
    expect(again.status).toBe('PLANNED')
    expect((await bells(m.id)).length).toBe(1)
    expect((await prisma.feedback.findUniqueOrThrow({ where: { id: fb.id } })).updatedAt.getTime()).toBe(before.updatedAt.getTime())

    // The other two decisions bell too, with their own human word.
    await setFeedbackStatus(su(admin), fb.id, 'DONE')
    await setFeedbackStatus(su(admin), fb.id, 'DECLINED')
    expect((await bells(m.id)).map((n) => payloadOf(n).message)).toEqual([
      'Your feedback was marked Planned', 'Your feedback was marked Done', 'Your feedback was marked Declined',
    ])
    expect(await prisma.emailOutbox.count()).toBe(0)
  })

  it('setFeedbackStatus rejects non-admins, unknown ids and unknown status strings', async () => {
    const admin = await makeUser({ role: 'admin' })
    const m = await makeUser({ role: 'member' })
    const fb = await makeFeedback({ authorId: m.id })
    await expect(setFeedbackStatus(su(m), fb.id, 'PLANNED')).rejects.toMatchObject({ code: 'forbidden' })
    // Permission is checked before existence — a non-admin learns nothing about ids.
    await expect(setFeedbackStatus(su(m), 'nope', 'PLANNED')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setFeedbackStatus(su(admin), fb.id, 'BOGUS' as FeedbackStatus)).rejects.toMatchObject({ code: 'invalid' })
    await expect(setFeedbackStatus(su(admin), 'nope', 'PLANNED')).rejects.toMatchObject({ code: 'not_found' })
    expect((await prisma.feedback.findUniqueOrThrow({ where: { id: fb.id } })).status).toBe('NEW')
  })

  it('does not bell an admin who decides on their own feedback', async () => {
    const admin = await makeUser({ role: 'admin' })
    const fb = await makeFeedback({ authorId: admin.id })
    await setFeedbackStatus(su(admin), fb.id, 'DONE')
    expect(await prisma.notification.count()).toBe(0)
  })

  it('deleteFeedback is admin-or-author-while-NEW, and is silent', async () => {
    const admin = await makeUser({ role: 'admin' })
    const author = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })

    const own = await makeFeedback({ authorId: author.id })
    await expect(deleteFeedback(su(other), own.id)).rejects.toMatchObject({ code: 'forbidden' })
    await deleteFeedback(su(author), own.id)
    expect(await prisma.feedback.findUnique({ where: { id: own.id } })).toBeNull()

    // Once review has started the author loses the arm; the admin keeps it.
    const reviewed = await makeFeedback({ authorId: author.id, status: 'REVIEWED' })
    await expect(deleteFeedback(su(author), reviewed.id)).rejects.toMatchObject({ code: 'forbidden' })
    await deleteFeedback(su(admin), reviewed.id)
    expect(await prisma.feedback.count()).toBe(0)

    await expect(deleteFeedback(su(admin), 'nope')).rejects.toMatchObject({ code: 'not_found' })
    // Silent: no bell, no email, no announce (there is no #lab-updates post in this feature).
    expect(await prisma.notification.count()).toBe(0)
    expect(await prisma.emailOutbox.count()).toBe(0)
    expect(await prisma.message.count()).toBe(0)
  })

  it('deleting removes the screenshot file, and survives a removal that fails', async () => {
    const author = await makeUser({ role: 'member' })
    await mkdir(FEEDBACK_UPLOADS, { recursive: true })
    const name = `${randomUUID()}.png`
    await writeFile(path.join(FEEDBACK_UPLOADS, name), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const dto = await submitOk(su(author), { screenshotPath: `/uploads/feedback/${name}` })
    expect(await readdir(FEEDBACK_UPLOADS)).toContain(name)

    await deleteFeedback(su(author), dto.id)
    expect(await readdir(FEEDBACK_UPLOADS)).not.toContain(name)

    // Best-effort: a removal that THROWS (a directory where a file was expected)
    // must not fail the delete — the row still goes.
    await mkdir(path.join(FEEDBACK_UPLOADS, 'stuck.png'), { recursive: true })
    const stuck = await makeFeedback({ authorId: author.id, screenshotPath: '/uploads/feedback/stuck.png' })
    await deleteFeedback(su(author), stuck.id)
    expect(await prisma.feedback.findUnique({ where: { id: stuck.id } })).toBeNull()
  })
})
