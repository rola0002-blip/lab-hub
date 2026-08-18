import path from 'node:path'
import os from 'node:os'
import { rm } from 'node:fs/promises'

// Confine attachment writes to a throwaway dir so the suite leaves the repo tree
// clean (the issue-routes.test.ts idiom). uploadsDir() reads UPLOADS_DIR lazily
// per call, so setting it here — before the route modules import — is enough.
const UPLOAD_DIR = path.join(os.tmpdir(), 'labhub-project-update-attachments')
process.env.UPLOADS_DIR = UPLOAD_DIR

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { saveUpload, removeUpload } from '@/lib/uploads'
import { resetDb, makeUser, makeProject, seedSystem } from '../factories'
import { postProjectUpdate, listProjectUpdates } from '@/features/issues/project-update-service'

// getSessionUser is the single auth seam — stub it per test (the issue-routes
// posture). Identity always comes from here, never the body.
const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { POST as attachPOST } from '@/app/api/project-updates/attachments/route'
import { GET as serve } from '@/app/uploads/[...path]/route'

const sessOf = (u: { id: string; name: string; email: string }, role: string) => ({ id: u.id, name: u.name, email: u.email, role })
const pdfForm = () => {
  const f = new FormData()
  f.set('file', new File([new Uint8Array(64)], 'growth log.pdf', { type: 'application/pdf' }))
  return new Request('http://t/api/project-updates/attachments', { method: 'POST', body: f })
}
const partsOf = (publicPath: string) => publicPath.replace(/^\/uploads\//, '').split('/')
const serveReq = (publicPath: string) => serve(new Request('http://t' + publicPath), { params: Promise.resolve({ path: partsOf(publicPath) }) })

afterAll(() => rm(UPLOAD_DIR, { recursive: true, force: true }))

describe('project-update attachments service (F6)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('a guest posting with attachments is forbidden before anything is written', async () => {
    const g = await makeUser({ role: 'guest' }); const p = await makeProject()
    await expect(postProjectUpdate({
      projectId: p.id, actorId: g.id, role: 'guest', health: 'ON_TRACK', body: 'nope',
      attachments: [{ path: '/uploads/project-updates/x.pdf', name: 'x.pdf', mime: 'application/pdf', size: 8 }],
    })).rejects.toMatchObject({ code: 'forbidden' })
    expect(await prisma.projectUpdate.count()).toBe(0)
    expect(await prisma.projectUpdateAttachment.count()).toBe(0)
  })

  it('more than 5 attachments is invalid and writes nothing', async () => {
    const u = await makeUser(); const p = await makeProject()
    const six = Array.from({ length: 6 }, (_, i) => ({ path: `/uploads/project-updates/f${i}.pdf`, name: `f${i}.pdf`, mime: 'application/pdf', size: 8 }))
    await expect(postProjectUpdate({ projectId: p.id, actorId: u.id, role: 'member', health: 'ON_TRACK', body: 'b', attachments: six }))
      .rejects.toMatchObject({ code: 'invalid', message: 'At most 5 files per update.' })
    expect(await prisma.projectUpdate.count()).toBe(0)
    expect(await prisma.projectUpdateAttachment.count()).toBe(0)
  })

  it('a foreign uploads-tree path is rejected (IDOR) and no row is created', async () => {
    const u = await makeUser(); const p = await makeProject()
    // Another feature's upload — chat — must not be referenceable here, and neither
    // may a traversal-suffixed path that passes the bare prefix check.
    for (const bad of ['/uploads/chat/other-user.pdf', '/uploads/project-updates/../chat/x.pdf']) {
      await expect(postProjectUpdate({
        projectId: p.id, actorId: u.id, role: 'member', health: 'ON_TRACK', body: 'b',
        attachments: [{ path: bad, name: 'o.pdf', mime: 'application/pdf', size: 8 }],
      })).rejects.toMatchObject({ code: 'invalid', message: 'Invalid attachment path.' })
    }
    expect(await prisma.projectUpdate.count()).toBe(0)
    expect(await prisma.projectUpdateAttachment.count()).toBe(0)
  })

  it('happy path: two real saved files attach to the update and ride the DTO + feed', async () => {
    const u = await makeUser(); const p = await makeProject()
    const pdfPath = await saveUpload(new File([new Uint8Array(64)], 'résumé growth.pdf', { type: 'application/pdf' }), 'project-updates')
    const txtPath = await saveUpload(new File([new Uint8Array(16)], 'notes.txt', { type: 'text/plain' }), 'project-updates')
    try {
      const dto = await postProjectUpdate({
        projectId: p.id, actorId: u.id, role: 'member', health: 'ON_TRACK', body: 'with files',
        attachments: [
          { path: pdfPath, name: 'résumé growth.pdf', mime: 'application/pdf', size: 64 },
          { path: txtPath, name: 'notes.txt', mime: 'text/plain', size: 16 },
        ],
      })
      // The service return carries them…
      expect(dto.attachments).toHaveLength(2)
      expect(dto.attachments.map((a) => a.name).sort()).toEqual(['notes.txt', 'résumé growth.pdf'])
      expect(dto.attachments.every((a) => a.id && a.path.startsWith('/uploads/project-updates/') && typeof a.size === 'number')).toBe(true)
      // …and so do the DB rows and the feed read (attachments: true on every include).
      expect(await prisma.projectUpdateAttachment.count({ where: { updateId: dto.id } })).toBe(2)
      const feed = await listProjectUpdates(p.id)
      expect(feed[0].attachments.map((a) => a.path).sort()).toEqual([pdfPath, txtPath].sort())
    } finally {
      await removeUpload(pdfPath); await removeUpload(txtPath)
    }
  })
})

describe('project-update attachments upload + serving routes (F6)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem(); mockUser.current = null })

  it('upload route: 401 signed out, 403 guest, 422 disallowed type, 201 member with meta', async () => {
    expect((await attachPOST(pdfForm())).status).toBe(401)

    const guest = await makeUser({ role: 'guest' }); mockUser.current = sessOf(guest, 'guest')
    expect((await attachPOST(pdfForm())).status).toBe(403)

    const m = await makeUser({ role: 'member' }); mockUser.current = sessOf(m, 'member')
    // no file part → 400
    expect((await attachPOST(new Request('http://t/api/project-updates/attachments', { method: 'POST', body: new FormData() }))).status).toBe(400)
    // disallowed mime → saveUpload throws → 422 with the allowed-list message
    const bad = new FormData(); bad.set('file', new File([new Uint8Array(10)], 'evil.exe', { type: 'application/x-msdownload' }))
    const rejected = await attachPOST(new Request('http://t/api/project-updates/attachments', { method: 'POST', body: bad }))
    expect(rejected.status).toBe(422)
    expect((await rejected.json()).message).toContain('max 25 MB')
    // happy path: the minted path is confined to the kind
    const ok = await attachPOST(pdfForm())
    expect(ok.status).toBe(201)
    const meta = await ok.json()
    expect(meta.path).toMatch(/^\/uploads\/project-updates\//)
    expect(meta).toMatchObject({ name: 'growth log.pdf', mime: 'application/pdf', size: 64 })
    await removeUpload(meta.path)
  })

  it('serving: 401 signed out, 200 + inline disposition + human name for any session; 404 on the DB miss', async () => {
    const m = await makeUser({ role: 'member' })
    const saved = await saveUpload(new File([new Uint8Array(32)], 'résumé growth.pdf', { type: 'application/pdf' }), 'project-updates')
    try {
      // No ProjectUpdateAttachment row → the DB-verified branch must 404 even for a
      // session, before any header decision (the documents orphan posture).
      mockUser.current = sessOf(m, 'member')
      expect((await serveReq(saved)).status).toBe(404)

      const p = await makeProject()
      const dto = await postProjectUpdate({
        projectId: p.id, actorId: m.id, role: 'member', health: 'ON_TRACK', body: 'served',
        attachments: [{ path: saved, name: 'résumé growth.pdf', mime: 'application/pdf', size: 32 }],
      })
      expect(dto.attachments[0].path).toBe(saved)

      mockUser.current = null // signed out → session arm
      expect((await serveReq(saved)).status).toBe(401)

      // Workspace-visible: a DIFFERENT member's session may read; pdf serves inline
      // with the recovered human filename (RFC 5987 star-encoded).
      const other = await makeUser({ role: 'member' }); mockUser.current = sessOf(other, 'member')
      const res = await serveReq(saved)
      expect(res.status).toBe(200)
      expect(res.headers.get('Cache-Control')).toBe('private, no-store')
      expect(res.headers.get('Content-Disposition')!.startsWith('inline;')).toBe(true)
      expect(decodeURIComponent(res.headers.get('Content-Disposition')!.split("filename*=UTF-8''")[1])).toBe('résumé growth.pdf')
    } finally {
      await removeUpload(saved)
    }
  })
})
