import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser, makeDocument } from '../factories'
import { searchDocuments } from '@/features/documents/document-search-service'
import { prisma } from '@/lib/db'

describe('searchDocuments', () => {
  beforeEach(resetDb)

  it('ranks filename matches and excludes non-matches and deleted rows', async () => {
    const u = await makeUser()
    const a = await makeDocument(u.id, { name: 'graphene transfer SOP.pdf' })
    await makeDocument(u.id, { name: 'pipette order form.xlsx' })
    const hits = await searchDocuments({ query: 'graphene SOP' })
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe(a.id)
    expect(hits[0].path).toBe(a.path)
    expect(await searchDocuments({ query: '   ' })).toEqual([])
    // A hard-deleted row is simply absent (no soft-delete column).
    await prisma.document.delete({ where: { id: a.id } })
    expect(await searchDocuments({ query: 'graphene SOP' })).toEqual([])
  })

  // Regression (Task 13 reviewer finding): the `english` parser lexes a filename with
  // dots/underscores/hyphens as a SINGLE token, so a component-word query used to miss
  // everything. The normalized Document.search column (20260713000200) + the query-side
  // normalization in searchDocuments make each component word searchable.
  it('finds component words split by dots, underscores and hyphens', async () => {
    const u = await makeUser()
    const proto = await makeDocument(u.id, { name: 'graphene-transfer-protocol.pdf' })
    const bn = await makeDocument(u.id, { name: 'Boron_Nitride_CVD.docx' })
    const sop = await makeDocument(u.id, { name: 'X-SOP.pdf' })

    expect((await searchDocuments({ query: 'protocol' })).map((h) => h.id)).toContain(proto.id)
    expect((await searchDocuments({ query: 'CVD' })).map((h) => h.id)).toContain(bn.id)
    expect((await searchDocuments({ query: 'SOP' })).map((h) => h.id)).toContain(sop.id)
    // Query-side normalization: a hyphenated query still matches the normalized column.
    expect((await searchDocuments({ query: 'graphene-transfer' })).map((h) => h.id)).toContain(proto.id)
  })
})
