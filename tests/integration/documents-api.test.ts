import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { saveUpload, uploadsDir } from '@/lib/uploads'
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
const fileForm = (file: File, folderId?: string) => { const f = new FormData(); f.set('file', file); if (folderId) f.set('folderId', folderId); return f }
// Snapshot the on-disk documents/ dir so a test can prove a saved file was (or was not) left behind.
const listDocs = async () => { try { return (await readdir(path.join(uploadsDir(), 'documents'))).sort() } catch { return [] } }

describe('documents API + serving', () => {
  beforeEach(async () => { await resetDb(); await seedSystem(); mockUser.current = null })

  it('upload is auth-gated: 401 signed out, 403 guest, 201 member; the row lands and #lab-updates gets a post', async () => {
    const g = await makeUser({ role: 'guest' })
    const m = await makeUser({ role: 'member' })
    const pdf = () => new File([new Uint8Array(2048)], 'CVD résumé.pdf', { type: 'application/pdf' })
    expect((await uploadReq(fileForm(pdf()))).status).toBe(401)
    mockUser.current = { ...g, role: 'guest' }
    expect((await uploadReq(fileForm(pdf()))).status).toBe(403)
    mockUser.current = { ...m, role: 'member' }
    const res = await uploadReq(fileForm(pdf()))
    expect(res.status).toBe(201)
    const dto = await res.json()
    expect(dto.path).toMatch(/^\/uploads\/documents\//)
    expect(await prisma.document.count()).toBe(1)
    expect(await prisma.message.count({ where: { conversationId: 'colossus-lab-updates' } })).toBe(1)
  })

  it('rejects an over-cap file (100 MB + 1 → 400) and a disallowed type (400)', async () => {
    const m = await makeUser({ role: 'member' })
    mockUser.current = { ...m, role: 'member' }
    // The size must be REAL bytes: serializing the FormData into a Request and
    // re-parsing via req.formData() recomputes File.size from the encoded body, so an
    // Object.defineProperty size override is lost (the parser reports the true length →
    // 201). Allocate the over-cap buffer for real (~64 ms; validateUpload rejects it
    // before any 100 MB hits disk).
    const over = new File([new Uint8Array(100 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' })
    expect((await uploadReq(fileForm(over))).status).toBe(400)
    expect((await uploadReq(fileForm(new File([new Uint8Array(4)], 'evil.exe', { type: 'application/x-msdownload' })))).status).toBe(400)
  })

  it('serves a pdf INLINE and an office file as ATTACHMENT, both carrying the unicode name; a stranger with a session may still read (workspace-visible)', async () => {
    const m = await makeUser({ role: 'member' })
    mockUser.current = { ...m, role: 'member' }
    const up = await uploadReq(fileForm(new File([new Uint8Array(32)], 'CVD résumé.pdf', { type: 'application/pdf' })))
    const pdfPath = (await up.json()).path
    const docx = new File([new Uint8Array(32)], 'report.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const officePath = (await (await uploadReq(fileForm(docx))).json()).path

    const other = await makeUser({ role: 'member' })
    mockUser.current = { ...other, role: 'member' } // a different signed-in user can read
    const rp = await serveReq(pdfPath)
    expect(rp.status).toBe(200)
    expect(rp.headers.get('Content-Disposition')!.startsWith('inline;')).toBe(true)
    expect(rp.headers.get('Content-Disposition')).toContain("filename*=UTF-8''")
    expect(decodeURIComponent(rp.headers.get('Content-Disposition')!.split("filename*=UTF-8''")[1])).toBe('CVD résumé.pdf')
    const ro = await serveReq(officePath)
    expect(ro.headers.get('Content-Disposition')!.startsWith('attachment;')).toBe(true)

    mockUser.current = null // signed out → 401
    expect((await serveReq(pdfPath)).status).toBe(401)
  })

  it('unlinks the just-saved file when createDocument rejects a stale folderId — no orphan on disk, no row', async () => {
    const m = await makeUser({ role: 'member' })
    mockUser.current = { ...m, role: 'member' }
    const before = await listDocs()
    // saveUpload writes the file, THEN createDocument throws PolicyError('invalid') on the
    // missing folder (§6.5). The route must removeUpload the orphan before mapping → 400.
    const res = await uploadReq(fileForm(new File([new Uint8Array(64)], 'orphan.pdf', { type: 'application/pdf' }), 'does-not-exist'))
    expect(res.status).toBe(400)
    expect(await prisma.document.count()).toBe(0) // no row committed
    expect(await listDocs()).toEqual(before)      // the saved file was unlinked — nothing left behind
  })

  it('serves 404 for a documents file present on disk but with no Document row (the DB-miss branch)', async () => {
    const m = await makeUser({ role: 'member' })
    mockUser.current = { ...m, role: 'member' }
    // A raw documents/ file whose bytes are readable but which was never registered as a
    // Document (an orphan). The serving route must 404 on the row miss, not stream it.
    const orphanPath = await saveUpload(new File([new Uint8Array(16)], 'ghost.pdf', { type: 'application/pdf' }), 'documents')
    expect(await prisma.document.count()).toBe(0)
    expect((await serveReq(orphanPath)).status).toBe(404)
  })
})
