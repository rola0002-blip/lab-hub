import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeProject, makeIssue } from '../factories'

describe('SP4 schema', () => {
  beforeEach(resetDb)

  it('auto-assigns COL numbers from the sequence and stores rank/search', async () => {
    const u = await makeUser()
    const p = await makeProject({ leadId: u.id })
    const a = await makeIssue(u.id, { title: 'CVD furnace calibration', projectId: p.id, rank: 'V' })
    const b = await makeIssue(u.id, { title: 'graphene transfer SOP', rank: 'k' })
    expect(b.number).toBe(a.number + 1)
    // Generated tsvector column is populated (queried raw, like Message.search).
    const hits = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Issue" WHERE search @@ websearch_to_tsquery('english', 'graphene')`
    expect(hits.map((h) => h.id)).toEqual([b.id])
    // Deleting the project nulls the FK, never the issue.
    await prisma.project.delete({ where: { id: p.id } })
    const still = await prisma.issue.findUnique({ where: { id: a.id } })
    expect(still?.projectId).toBeNull()
  })
})
