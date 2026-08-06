import { describe, it, expect, beforeEach, vi } from 'vitest'
import { saveUpload } from '@/lib/uploads'
import { resetDb, makeUser, seedSystem } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { POST as uploadDoc } from '@/app/api/documents/route'
import { GET as serve } from '@/app/uploads/[...path]/route'

const partsOf = (publicPath: string) => publicPath.replace(/^\/uploads\//, '').split('/')
const serveReq = (publicPath: string) => serve(new Request('http://t' + publicPath), { params: Promise.resolve({ path: partsOf(publicPath) }) })
const uploadReq = (form: FormData) => uploadDoc(new Request('http://t/api/documents', { method: 'POST', body: form }))
const fileForm = (file: File) => { const f = new FormData(); f.set('file', file); return f }

describe('uploads route — internet-facing nosniff', () => {
  beforeEach(async () => { await resetDb(); await seedSystem(); mockUser.current = null })

  it('sets X-Content-Type-Options: nosniff on a served document (inline attacker bytes can never be MIME-sniffed)', async () => {
    const m = await makeUser({ role: 'member' })
    mockUser.current = { ...m, role: 'member' }
    const up = await uploadReq(fileForm(new File([new Uint8Array(32)], 'report.pdf', { type: 'application/pdf' })))
    expect(up.status).toBe(201)
    const path = (await up.json()).path
    const res = await serveReq(path)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('session-gates feedback screenshots: 401 signed out, 200 private+no-store for any authed session incl. a guest', async () => {
    const m = await makeUser({ role: 'member' })
    mockUser.current = { ...m, role: 'member' }
    // The kind must be gated the moment it exists: the route's fall-through would
    // otherwise serve /uploads/feedback/* publicly with a SHARED cache header, and a
    // screenshot may show lab data (spec §7.1 — a release blocker).
    const shot = await saveUpload(new File([new Uint8Array(64)], 'shot.png', { type: 'image/png' }), 'feedback')
    expect(shot).toMatch(/^\/uploads\/feedback\//)

    mockUser.current = null
    expect((await serveReq(shot)).status).toBe(401)

    // Workspace-visible, not per-author: any session (guests included) may read, the
    // issues/documents posture rather than chat's membership model.
    const g = await makeUser({ role: 'guest' })
    mockUser.current = { ...g, role: 'guest' }
    const res = await serveReq(shot)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('leaves the public SP1 kinds public — the new gate must not widen to logo/equipment', async () => {
    const logo = await saveUpload(new File([new Uint8Array(32)], 'logo.png', { type: 'image/png' }), 'logo')
    mockUser.current = null
    const res = await serveReq(logo)
    expect(res.status).toBe(200) // the sign-in page renders it without a session
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400')
  })
})
