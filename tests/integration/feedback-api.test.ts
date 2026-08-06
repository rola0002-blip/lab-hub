import path from 'node:path'
import os from 'node:os'
import { readdir, rm } from 'node:fs/promises'

// Confine screenshot writes to a throwaway dir so the suite leaves the repo tree
// clean AND so the orphan assertions below own the directory outright. uploadsDir()
// reads UPLOADS_DIR lazily per call, so setting it here (before the route module
// imports) is enough — the issue-routes.test.ts idiom.
const UPLOAD_DIR = path.join(os.tmpdir(), 'labhub-feedback-api-uploads')
process.env.UPLOADS_DIR = UPLOAD_DIR

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { APP_VERSION } from '@/lib/version'
import { resetFeedbackRate, FEEDBACK_RATE_MAX } from '@/features/feedback/rate-limit'

// getSessionUser is the single auth seam — stub it per test (the documents-api /
// issue-routes idiom). Identity always comes from here, never from the body.
const session = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => session.current,
  requireUser: async () => session.current,
  requireAdmin: async () => session.current,
}))

import { POST as submitRoute } from '@/app/api/feedback/route'

const FEEDBACK_UPLOADS = path.join(UPLOAD_DIR, 'feedback')
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) LabHubTest'

const png = (bytes: number, name = 'shot.png') => new File([new Uint8Array(bytes)], name, { type: 'image/png' })

// Build the multipart body. `undefined` OMITS a field (the missing-field zod edges);
// every other value is set verbatim.
const form = (over: Record<string, string | File | undefined> = {}) => {
  const fields: Record<string, string | File | undefined> = {
    type: 'BUG', body: 'The booking grid drops taps on iPhone.', pagePath: '/booking', ...over,
  }
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.set(k, v)
  return f
}

const submitReq = (body: FormData, userAgent: string | null = UA) =>
  submitRoute(new Request('http://t/api/feedback', {
    method: 'POST', body, headers: userAgent === null ? {} : { 'user-agent': userAgent },
  }))

// Snapshot the on-disk feedback/ dir so a test can prove a saved screenshot was (or
// was not) left behind.
const listShots = async () => { try { return (await readdir(FEEDBACK_UPLOADS)).sort() } catch { return [] } }

describe('POST /api/feedback', () => {
  beforeEach(async () => {
    await resetDb()
    resetFeedbackRate()
    session.current = null
    await rm(FEEDBACK_UPLOADS, { recursive: true, force: true })
  })
  afterAll(async () => { await rm(UPLOAD_DIR, { recursive: true, force: true }) })

  it('401s a signed-out submit and persists nothing', async () => {
    const res = await submitReq(form())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(await prisma.feedback.count()).toBe(0)
  })

  it('stores the row with a server-minted screenshot path and SERVER-stamped version + user agent', async () => {
    const m = await makeUser({ role: 'member', name: 'Roland' })
    session.current = { ...m, role: 'member' }
    const res = await submitReq(form({ type: 'IDEA', screenshot: png(64), appVersion: '9.9.9-client', userAgent: 'spoofed' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true })

    const row = await prisma.feedback.findFirstOrThrow()
    expect(row.type).toBe('IDEA')
    expect(row.status).toBe('NEW')
    expect(row.authorId).toBe(m.id)
    expect(row.pagePath).toBe('/booking')
    expect(row.screenshotPath).toMatch(/^\/uploads\/feedback\//)   // server-minted, never client-supplied
    expect(await listShots()).toEqual([row.screenshotPath!.split('/').pop()])
    // The client cannot dictate context: the extra form fields above are ignored.
    expect(row.appVersion).toBe(APP_VERSION)
    expect(row.userAgent).toBe(UA)
  })

  it('lets a guest submit (the deliberate divergence from the issue composer) and slices a hostile user agent to 300', async () => {
    const g = await makeUser({ role: 'guest' })
    session.current = { ...g, role: 'guest' }
    expect((await submitReq(form({ body: 'The booking page scrolls sideways on my phone.' }), 'u'.repeat(400))).status).toBe(201)
    const row = await prisma.feedback.findFirstOrThrow()
    expect(row.authorId).toBe(g.id)
    expect(row.userAgent.length).toBe(300)
    // No user-agent header at all → stored empty, never null.
    expect((await submitReq(form(), null)).status).toBe(201)
    expect(await prisma.feedback.count({ where: { userAgent: '' } })).toBe(1)
  })

  it('400s the zod edges — bad type, missing/overlong body, missing pagePath — without touching the DB', async () => {
    const m = await makeUser({ role: 'member' })
    session.current = { ...m, role: 'member' }
    for (const bad of [
      form({ type: 'CRASH' }),                    // outside the BUG|IDEA enum — the route IS the type guard
      form({ type: 'bug' }),                      // case-sensitive
      form({ body: undefined }),
      form({ body: '' }),
      form({ body: 'x'.repeat(4001) }),           // over the 4000 cap: dies at zod, before any upload
      form({ pagePath: undefined }),
      form({ type: undefined }),
    ]) {
      const res = await submitReq(bad)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_request' })
    }
    expect(await prisma.feedback.count()).toBe(0)
    expect(await listShots()).toEqual([])

    // A non-multipart body is a parse failure, not a 500 — this route faces the internet.
    const json = await submitRoute(new Request('http://t/api/feedback', {
      method: 'POST', body: JSON.stringify({ type: 'BUG', body: 'hi', pagePath: '/' }), headers: { 'content-type': 'application/json' },
    }))
    expect(json.status).toBe(400)
    expect(await json.json()).toEqual({ error: 'bad_request' })
  })

  it('accepts a screenshot ABOVE the 2 MB image cap and rejects one above 10 MB, leaving no row and no file', async () => {
    const m = await makeUser({ role: 'member' })
    session.current = { ...m, role: 'member' }
    // 3 MB proves the cap is FEEDBACK_MAX and not the inherited 2 MB IMAGE_MAX — a
    // phone PNG screenshot routinely lands in this band (spec §7.1).
    expect((await submitReq(form({ screenshot: png(3 * 1024 * 1024) }))).status).toBe(201)
    expect((await listShots()).length).toBe(1)

    // The size must be REAL bytes: serializing the FormData into a Request and
    // re-parsing via req.formData() recomputes File.size from the encoded body, so an
    // Object.defineProperty size override is lost (the parser reports the true length →
    // 201). Allocate the over-cap buffer for real (validateUpload rejects it before any
    // 10 MB hits disk) — the documents-api.test.ts caveat.
    const over = await submitReq(form({ screenshot: png(10 * 1024 * 1024 + 1, 'big.png') }))
    expect(over.status).toBe(400)
    expect(await over.json()).toMatchObject({ error: 'invalid_upload' })
    // A non-image is rejected by the same gate.
    expect((await submitReq(form({ screenshot: new File([new Uint8Array(16)], 'evil.pdf', { type: 'application/pdf' }) }))).status).toBe(400)

    expect(await prisma.feedback.count()).toBe(1)     // only the 3 MB submit landed
    expect((await listShots()).length).toBe(1)        // and nothing else reached disk
  })

  it('429s the submit past the window AND unlinks the screenshot it had already saved', async () => {
    const m = await makeUser({ role: 'member' })
    session.current = { ...m, role: 'member' }
    for (let i = 0; i < FEEDBACK_RATE_MAX; i++) expect((await submitReq(form())).status).toBe(201)
    expect(await listShots()).toEqual([])

    // rate_limited is a RETURN, not a throw (the service's hybrid contract), so the
    // 429 branch carries its OWN cleanup — otherwise every rate-limited screenshot
    // leaks up to 10 MB to disk while "nothing persisted" (spec §10) holds for the row.
    const res = await submitReq(form({ screenshot: png(4096) }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    expect(await prisma.feedback.count()).toBe(FEEDBACK_RATE_MAX)
    expect(await listShots()).toEqual([])
  })

  it('unlinks the just-saved screenshot when the SERVICE throws after the upload — no orphan, no row', async () => {
    const m = await makeUser({ role: 'member' })
    session.current = { ...m, role: 'member' }
    // A whitespace-only body clears zod's non-empty check, the file lands, and THEN the
    // service's post-trim PolicyError('invalid') fires — the only trigger that exercises
    // the throw-after-upload arm (an overlong body would die at zod, before saveUpload).
    const res = await submitReq(form({ body: '   ', screenshot: png(512) }))
    expect(res.status).toBe(400)
    expect(await prisma.feedback.count()).toBe(0)
    expect(await listShots()).toEqual([])
  })
})
