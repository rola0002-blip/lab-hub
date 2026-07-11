import path from 'node:path'
import os from 'node:os'
import { rm } from 'node:fs/promises'

// Confine attachment writes to a throwaway dir so the suite leaves the repo tree
// clean. uploadsDir() reads UPLOADS_DIR lazily per call, so setting it here (before
// the route modules import) is enough.
const UPLOAD_DIR = path.join(os.tmpdir(), 'labhub-issue-routes-uploads')
process.env.UPLOADS_DIR = UPLOAD_DIR

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeIssue } from '../factories'

// getSessionUser / requireUser are the single auth seam — stub them per test
// (mirror chat-api.test.ts). Identity always comes from here, never the body.
const session = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => session.current,
  requireUser: async () => session.current,
  requireAdmin: async () => session.current,
}))
// Server actions call revalidatePath, which throws outside a Next request scope.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { GET as listGET, POST as createPOST } from '@/app/api/issues/route'
import { GET as detailGET } from '@/app/api/issues/[id]/route'
import { POST as movePOST } from '@/app/api/issues/[id]/move/route'
import { GET as searchGET } from '@/app/api/issues/search/route'
import { POST as attachPOST } from '@/app/api/issues/attachments/route'
import {
  createIssueAction, setStatusAction, createProjectAction, deleteProjectAction,
} from '@/app/(app)/issues/actions'

const sessOf = (u: { id: string; name: string; email: string }, role: string) => ({ id: u.id, name: u.name, email: u.email, role })
const jreq = (body: unknown) =>
  new Request('http://t', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

afterAll(() => rm(UPLOAD_DIR, { recursive: true, force: true }))

describe('issue routes', () => {
  beforeEach(async () => { await resetDb(); session.current = null })

  it('search jumps on an exact COL-n and returns FTS hits otherwise', async () => {
    const u = await makeUser({ role: 'member' }); session.current = sessOf(u, 'member')
    const iss = await makeIssue(u.id, { title: 'unique graphene marker', rank: 'V' })
    const jump = await (await searchGET(new Request(`http://x/api/issues/search?q=COL-${iss.number}`))).json()
    expect(jump.jump).toBe(`/issues/COL-${iss.number}`)
    const hits = await (await searchGET(new Request('http://x/api/issues/search?q=graphene'))).json()
    expect(hits.hits[0].id).toBe(iss.id)
  })

  it('search is 401 signed out', async () => {
    expect((await searchGET(new Request('http://x/api/issues/search?q=x'))).status).toBe(401)
  })

  it('GET /api/issues is 401 signed out and lists for a signed-in user', async () => {
    expect((await listGET(new Request('http://x/api/issues'))).status).toBe(401)
    const u = await makeUser({ role: 'member' }); session.current = sessOf(u, 'member')
    const iss = await makeIssue(u.id, { title: 'listed', rank: 'V' })
    const body = await (await listGET(new Request('http://x/api/issues'))).json()
    expect(body.issues.map((i: { id: string }) => i.id)).toContain(iss.id)
  })

  it('POST /api/issues: 401 signed out, 403 guest, 400 bad body, 200 member', async () => {
    expect((await createPOST(jreq({ title: 'x' }))).status).toBe(401)

    const guest = await makeUser({ role: 'guest' }); session.current = sessOf(guest, 'guest')
    expect((await createPOST(jreq({ title: 'x' }))).status).toBe(403)

    const m = await makeUser({ role: 'member' }); session.current = sessOf(m, 'member')
    expect((await createPOST(jreq({ title: '' }))).status).toBe(400) // fails min(1)
    const ok = await createPOST(jreq({ title: 'Calibrate SEM', priority: 'HIGH' }))
    expect(ok.status).toBe(200)
    const { issue } = await ok.json()
    expect(issue.identifier).toBe(`COL-${issue.number}`)
    // Identity is the session user, never the body: creator is the member.
    expect(issue.creator.id).toBe(m.id)
  })

  it('GET /api/issues/[id]: 401 signed out, 404 missing, 200 existing', async () => {
    const u = await makeUser({ role: 'member' })
    const iss = await makeIssue(u.id, { rank: 'V' })
    expect((await detailGET(new Request('http://x'), { params: Promise.resolve({ id: iss.id }) })).status).toBe(401)
    session.current = sessOf(u, 'member')
    expect((await detailGET(new Request('http://x'), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404)
    const ok = await detailGET(new Request('http://x'), { params: Promise.resolve({ id: iss.id }) })
    expect(ok.status).toBe(200)
    expect((await ok.json()).issue.id).toBe(iss.id)
  })

  it('a guest move is 403', async () => {
    const g = await makeUser({ role: 'guest' }); const owner = await makeUser({ role: 'member' })
    const iss = await makeIssue(owner.id, { status: 'TODO', rank: 'V' })
    session.current = sessOf(g, 'guest')
    const res = await movePOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ status: 'DONE' }) }), { params: Promise.resolve({ id: iss.id }) })
    expect(res.status).toBe(403)
  })

  it('move: 401 signed out, 400 bad body, 200 member (status changes)', async () => {
    const owner = await makeUser({ role: 'member' })
    const iss = await makeIssue(owner.id, { status: 'TODO', rank: 'V' })
    const params = { params: Promise.resolve({ id: iss.id }) }
    expect((await movePOST(jreq({ status: 'DONE' }), params)).status).toBe(401)
    session.current = sessOf(owner, 'member')
    expect((await movePOST(jreq({ status: 'NOT_A_STATUS' }), params)).status).toBe(400)
    const ok = await movePOST(jreq({ status: 'DONE' }), params)
    expect(ok.status).toBe(200)
    expect((await ok.json()).issue.status).toBe('DONE')
  })

  it('attachments: 401 signed out, 403 guest, 400 non-file/invalid, 200 member', async () => {
    const pdf = () => { const f = new FormData(); f.set('file', new File([new Uint8Array(64)], 'paper.pdf', { type: 'application/pdf' })); return new Request('http://x', { method: 'POST', body: f }) }
    expect((await attachPOST(pdf())).status).toBe(401)

    const guest = await makeUser({ role: 'guest' }); session.current = sessOf(guest, 'guest')
    expect((await attachPOST(pdf())).status).toBe(403)

    const m = await makeUser({ role: 'member' }); session.current = sessOf(m, 'member')
    // no file part
    expect((await attachPOST(new Request('http://x', { method: 'POST', body: new FormData() }))).status).toBe(400)
    // disallowed mime → invalid_upload → 400
    const bad = new FormData(); bad.set('file', new File([new Uint8Array(10)], 'evil.exe', { type: 'application/x-msdownload' }))
    expect((await attachPOST(new Request('http://x', { method: 'POST', body: bad }))).status).toBe(400)
    const ok = await attachPOST(pdf())
    expect(ok.status).toBe(200)
    const meta = await ok.json()
    expect(meta.path).toMatch(/^\/uploads\/issues\//)
    expect(meta).toMatchObject({ name: 'paper.pdf', mime: 'application/pdf', size: 64 })
  })
})

describe('issue server actions', () => {
  beforeEach(async () => { await resetDb(); session.current = null })

  it('createIssueAction: guest → ok:false (forbidden), member → ok:true with the created issue', async () => {
    const guest = await makeUser({ role: 'guest' }); session.current = sessOf(guest, 'guest')
    const denied = await createIssueAction({ title: 'nope' })
    expect(denied.ok).toBe(false)

    const m = await makeUser({ role: 'member' }); session.current = sessOf(m, 'member')
    const res = await createIssueAction({ title: 'From an action' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.creator.id).toBe(m.id)
  })

  it('setStatusAction maps a not_found PolicyError to ok:false', async () => {
    const m = await makeUser({ role: 'member' }); session.current = sessOf(m, 'member')
    const res = await setStatusAction('missing-id', 'DONE')
    expect(res).toEqual({ ok: false, message: expect.any(String) })
  })

  it('project actions: member creates, delete is admin-only', async () => {
    const m = await makeUser({ role: 'member' }); session.current = sessOf(m, 'member')
    const created = await createProjectAction({ name: 'CVD campaign' })
    expect(created.ok).toBe(true)
    const id = created.ok ? created.data.id : ''
    // member cannot delete
    expect((await deleteProjectAction(id)).ok).toBe(false)
    const admin = await makeUser({ role: 'admin' }); session.current = sessOf(admin, 'admin')
    expect((await deleteProjectAction(id)).ok).toBe(true)
    expect(await prisma.project.count()).toBe(0)
  })
})
