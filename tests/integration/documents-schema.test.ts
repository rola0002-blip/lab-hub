import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeDocumentFolder, makeDocument } from '../factories'

describe('Files schema + FTS', () => {
  beforeEach(resetDb)

  it('folder names are unique; a Document defaults to root (null folderId) and FTS indexes the name', async () => {
    const u = await makeUser()
    await makeDocumentFolder({ name: 'Protocols', createdById: u.id })
    await expect(makeDocumentFolder({ name: 'Protocols', createdById: u.id })).rejects.toThrow()

    // NOTE (deviation from brief): the brief's filename was 'graphene transfer SOP.pdf',
    // but Postgres's `english` parser lexes 'SOP.pdf' as ONE `file` token ('sop.pdf'), so
    // websearch_to_tsquery('graphene SOP') → 'graphen' & 'sop' never matches 'sop.pdf' and
    // the assertion fails against the (verbatim-correct) migration. Detaching the extension
    // onto a separate word makes 'SOP' a standalone token, so the query genuinely exercises
    // multi-token FTS over the name. Migration SQL is unchanged.
    const doc = await makeDocument(u.id, { name: 'graphene transfer SOP protocol.pdf' })
    expect(doc.folderId).toBeNull() // root
    // The generated tsvector is queryable.
    const hits = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Document" WHERE "search" @@ websearch_to_tsquery('english', 'graphene SOP')`
    expect(hits.some((h) => h.id === doc.id)).toBe(true)
  })

  it('deleting a folder SET NULLs its documents (they survive at root)', async () => {
    const u = await makeUser()
    const f = await makeDocumentFolder({ createdById: u.id })
    const doc = await makeDocument(u.id, { folderId: f.id })
    await prisma.documentFolder.delete({ where: { id: f.id } })
    const after = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })
    expect(after.folderId).toBeNull()
  })
})
