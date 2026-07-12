import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser, makeIssue } from '../factories'
import { searchIssues } from '@/features/issues/issue-search-service'

describe('searchIssues', () => {
  beforeEach(resetDb)

  it('ranks matches workspace-wide (no membership filter) and excludes non-matches', async () => {
    const u = await makeUser()
    const a = await makeIssue(u.id, { title: 'CVD furnace calibration', description: 'anneal the graphene', rank: 'V' })
    await makeIssue(u.id, { title: 'order pipette tips', rank: 'k' })
    const hits = await searchIssues({ query: 'graphene furnace' })
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe(a.id)
    expect(hits[0].identifier).toBe(`COL-${a.number}`)
    expect(await searchIssues({ query: '   ' })).toEqual([])
  })
})
