import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeDocumentFolder, makeDocument, seedSystem } from '../factories'
import { COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from '@/features/bot'
import { createDocument, renameDocument, moveDocument, deleteDocument, createFolder, renameFolder, deleteFolder, listFolders, listDocuments } from '@/features/documents/document-service'
import { PolicyError } from '@/features/documents/documents-policy'

describe('document-service', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('createDocument stores a root file, caps the name, guards the path, and announces to #lab-updates', async () => {
    const u = await makeUser({ name: 'Roland' })
    const dto = await createDocument({ uploaderId: u.id, uploaderName: u.name, name: 'x'.repeat(250) + '.pdf', path: '/uploads/documents/abc.pdf', mime: 'application/pdf', size: 2048, folderId: null })
    expect(dto.folderId).toBeNull()
    expect(dto.name.length).toBe(200)
    const post = await prisma.message.findFirst({ where: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: COLOSSUS_BOT_ID }, orderBy: { createdAt: 'desc' } })
    expect(post?.body).toContain('New file')
    expect(post?.body).toContain('Roland')
    // IDOR: a chat/issue path (fails the /uploads/documents/ prefix) can never be registered.
    await expect(createDocument({ uploaderId: u.id, uploaderName: u.name, name: 'evil', path: '/uploads/chat/abc.pdf', mime: 'application/pdf', size: 10, folderId: null })).rejects.toThrow(PolicyError)
    // IDOR: a traversal path (prefix-valid but contains '..') is also rejected — exercises the second guard arm.
    await expect(createDocument({ uploaderId: u.id, uploaderName: u.name, name: 'evil', path: '/uploads/documents/../chat/abc.pdf', mime: 'application/pdf', size: 10, folderId: null })).rejects.toThrow(PolicyError)
  })

  it('createDocument rejects a non-existent folderId', async () => {
    const u = await makeUser()
    await expect(createDocument({ uploaderId: u.id, uploaderName: u.name, name: 'a.pdf', path: '/uploads/documents/a.pdf', mime: 'application/pdf', size: 1, folderId: 'nope' })).rejects.toThrow(PolicyError)
  })

  it('rename/move re-point metadata; delete is uploader-or-admin', async () => {
    const owner = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })
    const admin = await makeUser({ role: 'admin' })
    const f = await makeDocumentFolder({ createdById: owner.id })
    const doc = await makeDocument(owner.id)
    await renameDocument({ userId: owner.id, role: 'member', id: doc.id, name: 'renamed.pdf' })
    await moveDocument({ userId: owner.id, role: 'member', id: doc.id, folderId: f.id })
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).folderId).toBe(f.id)
    // A different member cannot delete someone else's file; the admin can.
    await expect(deleteDocument({ userId: other.id, role: 'member', id: doc.id })).rejects.toThrow(PolicyError)
    await deleteDocument({ userId: admin.id, role: 'admin', id: doc.id })
    expect(await prisma.document.findUnique({ where: { id: doc.id } })).toBeNull()
  })

  it('folders: unique-name conflict is a friendly PolicyError; delete refuses a non-empty folder', async () => {
    const u = await makeUser({ role: 'member' })
    await createFolder({ userId: u.id, role: 'member', name: 'Protocols' })
    expect((await listFolders()).map((f) => f.name)).toContain('Protocols') // listFolders
    await expect(createFolder({ userId: u.id, role: 'member', name: 'Protocols' })).rejects.toThrow(PolicyError) // unique clash
    await expect(createFolder({ userId: u.id, role: 'member', name: '   ' })).rejects.toThrow(PolicyError)         // blank name
    const f = await makeDocumentFolder({ createdById: u.id })
    await makeDocument(u.id, { folderId: f.id })
    await expect(deleteFolder({ userId: u.id, role: 'member', id: f.id })).rejects.toThrow(PolicyError) // non-empty
    // empty it, then a rename + delete succeed for the creator.
    const docs = await listDocuments({ folderId: f.id })
    await moveDocument({ userId: u.id, role: 'member', id: docs[0].id, folderId: null })
    await renameFolder({ userId: u.id, role: 'member', id: f.id, name: 'Renamed' })
    await deleteFolder({ userId: u.id, role: 'member', id: f.id })
    expect(await prisma.documentFolder.findUnique({ where: { id: f.id } })).toBeNull()
  })

  it('a guest cannot upload/create-folder (assertCanUpload throws)', async () => {
    const g = await makeUser({ role: 'guest' })
    await expect(createFolder({ userId: g.id, role: 'guest', name: 'x' })).rejects.toThrow(PolicyError)
    await expect(renameDocument({ userId: g.id, role: 'guest', id: 'anything', name: 'x' })).rejects.toThrow(PolicyError)
  })

  it('a guest gets a 403 on EVERY mutation seam (full policy matrix)', async () => {
    const owner = await makeUser({ role: 'member' })
    const g = await makeUser({ role: 'guest' })
    const doc = await makeDocument(owner.id)                       // member-owned → guest hits `forbidden`, not `not_found`
    const folder = await makeDocumentFolder({ createdById: owner.id })
    // assertCanUpload seams (role-gated before any lookup)
    await expect(createFolder({ userId: g.id, role: 'guest', name: 'g' })).rejects.toThrow(PolicyError)
    await expect(renameDocument({ userId: g.id, role: 'guest', id: doc.id, name: 'g' })).rejects.toThrow(PolicyError)
    await expect(moveDocument({ userId: g.id, role: 'guest', id: doc.id, folderId: null })).rejects.toThrow(PolicyError)
    // assertCanDeleteDocument seam (uploader-or-admin) — guest is neither
    await expect(deleteDocument({ userId: g.id, role: 'guest', id: doc.id })).rejects.toThrow(PolicyError)
    // assertCanManageFolder seams (creator-or-admin) — guest is neither
    await expect(renameFolder({ userId: g.id, role: 'guest', id: folder.id, name: 'g' })).rejects.toThrow(PolicyError)
    await expect(deleteFolder({ userId: g.id, role: 'guest', id: folder.id })).rejects.toThrow(PolicyError)
    // Nothing was mutated by any of the rejected calls.
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).name).toBe(doc.name)
    expect(await prisma.documentFolder.findUnique({ where: { id: folder.id } })).not.toBeNull()
  })

  it('not_found + folder edge branches throw typed PolicyErrors (covers the gated error arms)', async () => {
    const u = await makeUser({ role: 'member' })
    // document not_found on rename/move/delete — a member reaches the lookup (a guest would
    // throw at assertCanUpload first), so these exercise the `!doc` throw arms.
    await expect(renameDocument({ userId: u.id, role: 'member', id: 'ghost', name: 'x' })).rejects.toThrow(PolicyError)
    await expect(moveDocument({ userId: u.id, role: 'member', id: 'ghost', folderId: null })).rejects.toThrow(PolicyError)
    await expect(deleteDocument({ userId: u.id, role: 'member', id: 'ghost' })).rejects.toThrow(PolicyError)
    // folder not_found on rename/delete
    await expect(renameFolder({ userId: u.id, role: 'member', id: 'ghost', name: 'x' })).rejects.toThrow(PolicyError)
    await expect(deleteFolder({ userId: u.id, role: 'member', id: 'ghost' })).rejects.toThrow(PolicyError)
    // renameFolder: blank name (the non-blank guard) + unique clash (the P2002 catch)
    const a = await createFolder({ userId: u.id, role: 'member', name: 'Alpha' })
    await createFolder({ userId: u.id, role: 'member', name: 'Beta' })
    await expect(renameFolder({ userId: u.id, role: 'member', id: a.id, name: '   ' })).rejects.toThrow(PolicyError)
    await expect(renameFolder({ userId: u.id, role: 'member', id: a.id, name: 'Beta' })).rejects.toThrow(PolicyError)
    // createDocument onto a VALID folder — exercises the folder-truthy success path + the
    // `folder?.name` announce string (createFolder success path is exercised above).
    const dto = await createDocument({ uploaderId: u.id, uploaderName: u.name, name: 'in-folder.pdf', path: '/uploads/documents/inf.pdf', mime: 'application/pdf', size: 12, folderId: a.id })
    expect(dto.folderId).toBe(a.id)
  })

  describe('listDocuments scope (SP8 §3.1)', () => {
    it('returns documents from every folder when folderId is omitted, root-only when null', async () => {
      const u = await makeUser()
      const folder = await makeDocumentFolder({ createdById: u.id })
      const inFolder = await makeDocument(u.id, { folderId: folder.id })
      const atRoot = await makeDocument(u.id)
      const all = await listDocuments({})
      expect(all.map((d) => d.id).sort()).toEqual([inFolder.id, atRoot.id].sort())
      expect(all.find((d) => d.id === inFolder.id)?.folderName).toBe(folder.name)
      expect(all.find((d) => d.id === atRoot.id)?.folderName).toBeNull()
      const root = await listDocuments({ folderId: null })
      expect(root.map((d) => d.id)).toEqual([atRoot.id])
      const scoped = await listDocuments({ folderId: folder.id })
      expect(scoped.map((d) => d.id)).toEqual([inFolder.id])
    })
    it('take bounds the newest-first read', async () => {
      const u = await makeUser()
      for (let i = 0; i < 3; i++) await makeDocument(u.id, { createdAt: new Date(Date.now() - i * 60_000) })
      expect((await listDocuments({ take: 2 })).length).toBe(2)
    })
  })
})
