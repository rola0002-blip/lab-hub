import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeChannel, makeMember, makeMessage } from '../factories'
import { createIssue } from '@/features/issues/issue-service'
import { resolveIssueRefs } from '@/features/issues/issue-ref-service'

describe('create-from-message + ref resolution', () => {
  beforeEach(resetDb)

  it('sets originMessageId and survives message deletion; refs resolve batched', async () => {
    const u = await makeUser({ role: 'member' })
    const c = await makeChannel(); await makeMember(c.id, u.id)
    const m = await makeMessage(c.id, u.id, { body: 'furnace is down\nneeds a new element' })
    const iss = await createIssue({ actorId: u.id, role: 'member', title: 'furnace is down', description: `> furnace is down`, originMessageId: m.id })
    expect(iss.originMessageId).toBe(m.id)
    // Deleting the source message nulls the FK, never deletes the issue (onDelete: SetNull).
    await prisma.message.delete({ where: { id: m.id } })
    expect((await prisma.issue.findUnique({ where: { id: iss.id } }))?.originMessageId).toBeNull()
    // Batched resolution returns identifier/title/status for a set of numbers.
    const refs = await resolveIssueRefs([iss.number, 999999])
    expect(refs).toHaveLength(1)
    expect(refs[0].identifier).toBe(`COL-${iss.number}`)
  })
})
