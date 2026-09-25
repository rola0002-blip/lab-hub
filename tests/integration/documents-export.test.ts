import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { saveUpload, removeUpload } from '@/lib/uploads'
import { resetDb, makeUser, seedSystem } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { GET } from '@/app/api/documents/export/route'

const savedPaths: string[] = []
const call = (ids: string[] | string) =>
  GET(new Request('http://x/api/documents/export?ids=' + encodeURIComponent(Array.isArray(ids) ? ids.join(',') : ids)))

async function makeRealDoc(uploaderId: string, name: string, folderId: string | null) {
  const file = new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'application/pdf' })
  const path = await saveUpload(file, 'documents')
  savedPaths.push(path)
  return prisma.document.create({ data: { name, path, mime: 'application/pdf', size: 4, uploaderId, folderId } })
}

function zipNames(buf: Buffer): string[] {
  const names: string[] = []
  let p = 0
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(p + 26)
    const size = buf.readUInt32LE(p + 22)
    names.push(buf.subarray(p + 30, p + 30 + nameLen).toString('utf8'))
    p += 30 + nameLen + size
  }
  return names
}

describe('documents export', () => {
  beforeEach(async () => { await resetDb(); await seedSystem(); mockUser.current = null })
  // saveUpload writes real bytes under UPLOADS_DIR (./data/uploads in this env) —
  // documents-api.test.ts has no per-file teardown, so collect + unlink here.
  afterAll(async () => { for (const p of savedPaths) await removeUpload(p) })

  it('401 signed out; every denial carries private, no-store', async () => {
    const res = await call(['x'])
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('a GUEST gets a 200 zip — read is any-authed', async () => {
    const u = await makeUser()
    const g = await makeUser({ role: 'guest' })
    const d = await makeRealDoc(u.id, 'sop.pdf', null)
    mockUser.current = { ...g }
    const res = await call([d.id])
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="labhub-files-\d{8}\.zip"/)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(zipNames(body)).toEqual(['sop.pdf'])
  })

  it('folder-prefixes entries, dedupes same names, preserves caller order, skips deleted-since-render ids', async () => {
    const u = await makeUser()
    const folder = await prisma.documentFolder.create({ data: { name: 'chemical list', createdById: u.id } })
    const a = await makeRealDoc(u.id, 'sds.pdf', folder.id)
    const ghost = await makeRealDoc(u.id, 'ghost.pdf', null)
    await prisma.document.delete({ where: { id: ghost.id } })
    const b = await makeRealDoc(u.id, 'sds.pdf', folder.id)
    const c = await makeRealDoc(u.id, 'readme.txt', null)
    mockUser.current = { ...u }
    const res = await call([c.id, a.id, ghost.id, b.id])
    expect(res.status).toBe(200)
    expect(zipNames(Buffer.from(await res.arrayBuffer()))).toEqual(['readme.txt', 'chemical list/sds.pdf', 'chemical list/sds (2).pdf'])
  })

  it('dedupes repeated ids — exactly one entry, no " (2)"', async () => {
    const u = await makeUser()
    const d = await makeRealDoc(u.id, 'sop.pdf', null)
    mockUser.current = { ...u }
    const res = await call([d.id, d.id])
    expect(res.status).toBe(200)
    expect(zipNames(Buffer.from(await res.arrayBuffer()))).toEqual(['sop.pdf'])
  })

  it('exactly 100 raw ids is allowed (cap counts the raw pre-dedupe list)', async () => {
    const u = await makeUser()
    const d = await makeRealDoc(u.id, 'only.pdf', null)
    mockUser.current = { ...u }
    const res = await call([d.id, ...Array.from({ length: 99 }, (_, i) => `ghost-${i}`)])
    expect(res.status).toBe(200)
    expect(zipNames(Buffer.from(await res.arrayBuffer()))).toEqual(['only.pdf'])
  })

  it('413 when resolved row bytes exceed 1 GiB; denial carries private, no-store', async () => {
    const u = await makeUser()
    const d = await makeRealDoc(u.id, 'big.pdf', null)
    await prisma.document.update({ where: { id: d.id }, data: { size: 1_100_000_000 } })
    mockUser.current = { ...u }
    const res = await call([d.id])
    expect(res.status).toBe(413)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('400 on empty ids and >100 ids; 404 when nothing resolves', async () => {
    const u = await makeUser()
    mockUser.current = { ...u }
    expect((await call('')).status).toBe(400)
    expect((await call(Array.from({ length: 101 }, (_, i) => `id-${i}`))).status).toBe(400)
    expect((await call(['nope'])).status).toBe(404)
  })

  it('a doc whose bytes vanished on disk is skipped, not a 500', async () => {
    const u = await makeUser()
    const d = await makeRealDoc(u.id, 'here.pdf', null)
    const gone = await makeRealDoc(u.id, 'gone.pdf', null)
    await removeUpload(gone.path)
    mockUser.current = { ...u }
    const res = await call([d.id, gone.id])
    expect(res.status).toBe(200)
    expect(zipNames(Buffer.from(await res.arrayBuffer()))).toEqual(['here.pdf'])
  })
})
