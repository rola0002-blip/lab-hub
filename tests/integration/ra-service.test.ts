import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeDocumentFolder, makeDocument, makeRaAcknowledgment } from '../factories'
import type { SessionUser } from '@/lib/session'
import { PolicyError } from '@/features/ra/ra-policy'
import {
  raOptions, submitRaAcknowledgment, listMyRaAcknowledgments, listAllRaAcknowledgments, revokeRaAcknowledgment,
} from '@/features/ra/ra-service'

const su = (u: { id: string; name: string; email: string; role: string }): SessionUser =>
  ({ id: u.id, name: u.name, email: u.email, role: u.role as SessionUser['role'] })

// Distinct createdAt stamps for the ordering assertions — createdAt alone is not
// a total order (two inserts can share a millisecond), the feedback-suite idiom.
const stampAt = (id: string, iso: string) =>
  prisma.raAcknowledgment.update({ where: { id }, data: { createdAt: new Date(iso) } })

describe('ra-service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('submitRaAcknowledgment stores the row with a documentName snapshot, trimmed matric, ISO createdAt and author identity', async () => {
    const m = await makeUser({ role: 'member', name: 'Roland' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const doc = await makeDocument(m.id, { folderId: folder.id, name: 'sop-2026.pdf' })

    const dto = await submitRaAcknowledgment(su(m), { documentId: doc.id, matricNumber: '  A0123456X  ' })
    expect(dto.documentId).toBe(doc.id)
    expect(dto.documentName).toBe('sop-2026.pdf')            // snapshot at submit
    expect(dto.matricNumber).toBe('A0123456X')               // trimmed
    expect(dto.createdAt).toBe(new Date(dto.createdAt).toISOString()) // ISO string, MessageDto convention
    expect(dto.author).toEqual({ id: m.id, name: 'Roland', email: m.email })

    const row = await prisma.raAcknowledgment.findUniqueOrThrow({ where: { id: dto.id } })
    expect(row.userId).toBe(m.id)
    expect(row.documentName).toBe('sop-2026.pdf')
    expect(row.matricNumber).toBe('A0123456X')
  })

  it('lets a guest submit (external students doing the lab work)', async () => {
    const g = await makeUser({ role: 'guest' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const doc = await makeDocument(g.id, { folderId: folder.id })
    const dto = await submitRaAcknowledgment(su(g), { documentId: doc.id, matricNumber: 'B9876543Z' })
    expect(dto.author.id).toBe(g.id)
    expect(await prisma.raAcknowledgment.count()).toBe(1)
  })

  it('rejects a duplicate (userId, documentId) with a typed PolicyError, never a raw P2002', async () => {
    const m = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const doc = await makeDocument(m.id, { folderId: folder.id })
    await makeRaAcknowledgment(m.id, doc.id)
    await expect(submitRaAcknowledgment(su(m), { documentId: doc.id, matricNumber: 'A0123456X' }))
      .rejects.toMatchObject({ code: 'invalid', message: 'You have already acknowledged this RA.' })
    expect(await prisma.raAcknowledgment.count()).toBe(1) // nothing persisted
  })

  it('rejects a document living in a DIFFERENT folder', async () => {
    const m = await makeUser({ role: 'member' })
    await makeDocumentFolder({ name: 'RA' })
    const other = await makeDocumentFolder({ name: 'other' })
    const doc = await makeDocument(m.id, { folderId: other.id })
    await expect(submitRaAcknowledgment(su(m), { documentId: doc.id, matricNumber: 'A0123456X' }))
      .rejects.toMatchObject({ code: 'invalid', message: 'Pick an RA document from the list.' })
    expect(await prisma.raAcknowledgment.count()).toBe(0)
  })

  it('rejects everything when no RA folder exists yet', async () => {
    const m = await makeUser({ role: 'member' })
    await expect(submitRaAcknowledgment(su(m), { documentId: 'anything', matricNumber: 'A0123456X' }))
      .rejects.toMatchObject({ code: 'invalid', message: 'No RA folder exists yet — an admin creates it in Files.' })
  })

  it('rejects a matric that is empty after trim or over 32 characters', async () => {
    const m = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const doc = await makeDocument(m.id, { folderId: folder.id })
    const msg = 'Enter your matriculation number (at most 32 characters).'
    await expect(submitRaAcknowledgment(su(m), { documentId: doc.id, matricNumber: '   ' }))
      .rejects.toMatchObject({ code: 'invalid', message: msg })
    await expect(submitRaAcknowledgment(su(m), { documentId: doc.id, matricNumber: 'A'.repeat(33) }))
      .rejects.toMatchObject({ code: 'invalid', message: msg })
    expect(await prisma.raAcknowledgment.count()).toBe(0)
  })

  it('degrades forged non-string input to a PolicyError, not a TypeError', async () => {
    const m = await makeUser({ role: 'member' })
    await makeDocumentFolder({ name: 'RA' })
    await expect(submitRaAcknowledgment(su(m), { documentId: 42 as unknown as string, matricNumber: 'X' }))
      .rejects.toThrow(PolicyError)
    await expect(submitRaAcknowledgment(su(m), { documentId: 42 as unknown as string, matricNumber: 'X' }))
      .rejects.toMatchObject({ code: 'invalid', message: 'Invalid acknowledgment.' })
  })

  it('listAllRaAcknowledgments is admin-only; admin sees every row newest first', async () => {
    const admin = await makeUser({ role: 'admin' })
    const m = await makeUser({ role: 'member', name: 'Roland' })
    const g = await makeUser({ role: 'guest' })
    const older = await makeRaAcknowledgment(m.id, 'doc-old', { documentName: 'old.pdf' })
    const newer = await makeRaAcknowledgment(g.id, 'doc-new', { documentName: 'new.pdf' })
    await stampAt(older.id, '2026-08-01T00:00:00.000Z')
    await stampAt(newer.id, '2026-08-05T00:00:00.000Z')
    // Permission before existence — a member learns nothing, whatever the id space holds.
    await expect(listAllRaAcknowledgments(su(m))).rejects.toMatchObject({ code: 'forbidden', message: 'Only admins can view RA records.' })
    const all = await listAllRaAcknowledgments(su(admin))
    expect(all.map((r) => r.documentName)).toEqual(['new.pdf', 'old.pdf'])
    expect(all[0].author.id).toBe(g.id)
    expect(all[1].author).toEqual({ id: m.id, name: 'Roland', email: m.email })

    // listMy returns only the caller's rows, newest first.
    await makeRaAcknowledgment(g.id, 'doc-mid')
    const mine = await listMyRaAcknowledgments(su(g))
    expect(mine.map((r) => r.documentId)).toEqual(['doc-mid', 'doc-new'])
  })

  it('raOptions reports the folder, its documents and the caller’s acknowledged ids', async () => {
    const m = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const d1 = await makeDocument(m.id, { folderId: folder.id, name: 'ra-1.pdf' })
    const d2 = await makeDocument(m.id, { folderId: folder.id, name: 'ra-2.pdf' })
    await makeDocument(m.id, { name: 'loose.pdf' }) // folder-less, must not appear
    await makeRaAcknowledgment(m.id, d1.id)
    await makeRaAcknowledgment(other.id, d2.id) // someone else's ack, invisible here

    const opts = await raOptions(su(m))
    expect(opts.folderExists).toBe(true)
    expect(opts.documents.map((d) => d.id).sort()).toEqual([d1.id, d2.id].sort())
    expect(opts.documents.every((d) => typeof d.name === 'string')).toBe(true)
    expect(opts.acknowledgedDocumentIds).toEqual([d1.id])

    // Without the folder: a flat "not yet" with no document noise.
    await resetDb()
    const bare = await makeUser({ role: 'guest' })
    expect(await raOptions(su(bare))).toEqual({ folderExists: false, documents: [], acknowledgedDocumentIds: [] })
  })

  describe('revokeRaAcknowledgment', () => {
    it('lets the author revoke their own row (any role) and frees re-acknowledgement', async () => {
      const g = await makeUser({ role: 'guest' })
      const folder = await makeDocumentFolder({ name: 'RA' })
      const doc = await makeDocument(g.id, { folderId: folder.id, name: 'sop-2026.pdf' })
      const ack = await makeRaAcknowledgment(g.id, doc.id)
      await revokeRaAcknowledgment(su(g), ack.id)
      expect(await prisma.raAcknowledgment.count()).toBe(0)
      // the unique freed: the same user+document can be acknowledged again
      const again = await submitRaAcknowledgment(su(g), { documentId: doc.id, matricNumber: 'B7654321Z' })
      expect(again.documentId).toBe(doc.id)
    })

    it('lets an admin revoke someone else’s row', async () => {
      const m = await makeUser({ role: 'member' })
      const a = await makeUser({ role: 'admin' })
      const folder = await makeDocumentFolder({ name: 'RA' })
      const doc = await makeDocument(m.id, { folderId: folder.id })
      const ack = await makeRaAcknowledgment(m.id, doc.id)
      await revokeRaAcknowledgment(su(a), ack.id)
      expect(await prisma.raAcknowledgment.count()).toBe(0)
    })

    it('rejects a non-author non-admin with forbidden, keeping the row', async () => {
      const m = await makeUser({ role: 'member' })
      const other = await makeUser({ role: 'member' })
      const folder = await makeDocumentFolder({ name: 'RA' })
      const doc = await makeDocument(m.id, { folderId: folder.id })
      const ack = await makeRaAcknowledgment(m.id, doc.id)
      await expect(revokeRaAcknowledgment(su(other), ack.id))
        .rejects.toMatchObject({ code: 'forbidden', message: 'Only the acknowledger or an admin can revoke this record.' })
      expect(await prisma.raAcknowledgment.count()).toBe(1)
    })

    it('not_found for a missing id, invalid for a forged non-string', async () => {
      const m = await makeUser({ role: 'member' })
      await expect(revokeRaAcknowledgment(su(m), 'nope')).rejects.toMatchObject({ code: 'not_found' })
      await expect(revokeRaAcknowledgment(su(m), 42 as unknown as string)).rejects.toMatchObject({ code: 'invalid' })
    })
  })
})
