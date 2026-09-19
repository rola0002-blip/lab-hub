import path from 'node:path'
import os from 'node:os'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'

// Restore copies REAL bytes via copyUpload, so confine every write to a
// throwaway dir instead of the repo's own ./data/uploads (the
// uploads-headers.test.ts idiom — uploadsDir() reads UPLOADS_DIR lazily).
const UPLOAD_DIR = path.join(os.tmpdir(), 'labhub-document-versions')
process.env.UPLOADS_DIR = UPLOAD_DIR

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, seedSystem } from '../factories'
import { uploadsDir } from '@/lib/uploads'
import { createDocument, deleteDocument } from '@/features/documents/document-service'
import { PolicyError } from '@/features/documents/documents-policy'
import { uploadNewVersion, listVersions, restoreVersion } from '@/features/documents/version-service'

const onDisk = (publicPath: string) => path.join(uploadsDir(), publicPath.replace(/^\/uploads\//, ''))

async function seedDoc() {
  const u = await makeUser({ role: 'member' })
  await writeFile(onDisk('/uploads/documents/a.pdf'), Buffer.alloc(10))
  const doc = await prisma.document.create({ data: { name: 'SOP.pdf', path: '/uploads/documents/a.pdf', mime: 'application/pdf', size: 10, uploaderId: u.id, latestVersion: 1 } })
  await prisma.documentVersion.create({ data: { documentId: doc.id, version: 1, path: doc.path, name: doc.name, mime: doc.mime, size: 10, uploadedById: u.id } })
  return { u, doc }
}

describe('document versions', () => {
  beforeEach(async () => {
    await resetDb()
    await seedSystem()
    await mkdir(path.join(UPLOAD_DIR, 'documents'), { recursive: true })
  })
  afterAll(async () => { await rm(UPLOAD_DIR, { recursive: true, force: true }) })

  it('createDocument writes the v1 version row in the same transaction', async () => {
    const u = await makeUser({ role: 'member' })
    const dto = await createDocument({ uploaderId: u.id, uploaderName: u.name, name: 'SOP.pdf', path: '/uploads/documents/a.pdf', mime: 'application/pdf', size: 10, folderId: null })
    expect(dto.latestVersion).toBe(1)
    const vs = await listVersions(dto.id)
    expect(vs.map((v) => v.version)).toEqual([1])
    expect(vs[0].name).toBe('SOP.pdf')
    expect(vs[0].uploadedByName).toBe(u.name)
  })

  it('uploadNewVersion bumps latest and keeps history', async () => {
    const { u, doc } = await seedDoc()
    await writeFile(onDisk('/uploads/documents/b.pdf'), Buffer.alloc(20))
    const dto = await uploadNewVersion({ documentId: doc.id, uploaderId: u.id, role: 'member', name: 'SOP.pdf', path: '/uploads/documents/b.pdf', mime: 'application/pdf', size: 20 })
    expect(dto.latestVersion).toBe(2)
    expect(dto.path).toBe('/uploads/documents/b.pdf')
    const vs = await listVersions(doc.id)
    expect(vs.map((v) => v.version)).toEqual([2, 1]) // newest first
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).path).toBe('/uploads/documents/b.pdf')
  })

  it('restore promotes old bytes as a NEW version (linear history)', async () => {
    const { u, doc } = await seedDoc()
    await writeFile(onDisk('/uploads/documents/b.pdf'), Buffer.alloc(20))
    await uploadNewVersion({ documentId: doc.id, uploaderId: u.id, role: 'member', name: 'SOP.pdf', path: '/uploads/documents/b.pdf', mime: 'application/pdf', size: 20 })
    const v1 = (await listVersions(doc.id)).find((v) => v.version === 1)!
    // restoreVersion must call copyUpload(v1 path) and register version 3
    const dto = await restoreVersion({ versionId: v1.id, userId: u.id, role: 'member' })
    expect(dto.latestVersion).toBe(3)
    // fresh bytes at a fresh minted path — history stays linear, v1's file untouched
    const v1row = await prisma.documentVersion.findUniqueOrThrow({ where: { id: v1.id } })
    expect(dto.path).not.toBe(v1row.path)
    expect(dto.path).toMatch(/^\/uploads\/documents\/[0-9a-f-]+\.pdf$/)
    expect(dto.size).toBe(10)
    expect((await listVersions(doc.id)).map((v) => v.version)).toEqual([3, 2, 1])
  })

  it('restore rejects restoring the current latest version', async () => {
    const { u, doc } = await seedDoc()
    const latest = (await listVersions(doc.id)).find((v) => v.version === doc.latestVersion)!
    await expect(restoreVersion({ versionId: latest.id, userId: u.id, role: 'member' })).rejects.toThrowError(/already the latest/i)
  })

  it('non-uploader member cannot upload a new version', async () => {
    const { doc } = await seedDoc()
    const other = await makeUser({ role: 'member' })
    await expect(uploadNewVersion({ documentId: doc.id, uploaderId: other.id, role: 'member', name: 'x', path: '/uploads/documents/c.pdf', mime: 'application/pdf', size: 1 }))
      .rejects.toThrowError(/uploader or an admin/i)
    // an admin CAN version someone else's upload
    const admin = await makeUser({ role: 'admin' })
    const dto = await uploadNewVersion({ documentId: doc.id, uploaderId: admin.id, role: 'admin', name: 'x.pdf', path: '/uploads/documents/c.pdf', mime: 'application/pdf', size: 1 })
    expect(dto.latestVersion).toBe(2)
  })

  it('deleteDocument unlinks every version file, not just the latest', async () => {
    const { u, doc } = await seedDoc()
    await writeFile(onDisk('/uploads/documents/b.pdf'), Buffer.alloc(20))
    await uploadNewVersion({ documentId: doc.id, uploaderId: u.id, role: 'member', name: 'SOP.pdf', path: '/uploads/documents/b.pdf', mime: 'application/pdf', size: 20 })
    await deleteDocument({ userId: u.id, role: 'member', id: doc.id })
    expect(await prisma.document.findUnique({ where: { id: doc.id } })).toBeNull()
    expect(await prisma.documentVersion.findMany({ where: { documentId: doc.id } })).toEqual([])
    for (const f of ['a.pdf', 'b.pdf']) {
      await expect(access(onDisk(`/uploads/documents/${f}`))).rejects.toThrow()
    }
  })

  it('uploadNewVersion rejects a path outside /uploads/documents (IDOR parity with createDocument)', async () => {
    const { u, doc } = await seedDoc()
    await expect(uploadNewVersion({ documentId: doc.id, uploaderId: u.id, role: 'member', name: 'evil', path: '/uploads/chat/abc.pdf', mime: 'application/pdf', size: 10 }))
      .rejects.toThrow(PolicyError)
  })
})
