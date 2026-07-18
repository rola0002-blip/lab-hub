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
    expect(refs[0].identifier).toBe(`LAB-${iss.number}`)
  })

  it('rejects a forged originMessageId from a non-member; a member can link (S2)', async () => {
    const insider = await makeUser({ role: 'member' })
    const outsider = await makeUser({ role: 'member' })
    const priv = await makeChannel(); await makeMember(priv.id, insider.id) // outsider is NOT a member
    const m = await makeMessage(priv.id, insider.id, { body: 'secret plan' })
    // A non-member forging a valid message id, and a missing message id, both raise
    // the SAME not_found — no leak of whether the private channel/message exists.
    await expect(createIssue({ actorId: outsider.id, role: 'member', title: 'peek', originMessageId: m.id }))
      .rejects.toMatchObject({ name: 'PolicyError', code: 'not_found' })
    await expect(createIssue({ actorId: outsider.id, role: 'member', title: 'ghost', originMessageId: 'no-such-message' }))
      .rejects.toMatchObject({ name: 'PolicyError', code: 'not_found' })
    // A member of the conversation CAN attach the backlink.
    const ok = await createIssue({ actorId: insider.id, role: 'member', title: 'ok', originMessageId: m.id })
    expect(ok.originMessageId).toBe(m.id)
    // Nothing persisted for the rejected attempts.
    expect(await prisma.issue.count({ where: { title: { in: ['peek', 'ghost'] } } })).toBe(0)
  })

  it('resolveIssueRefs drops out-of-int4-range numbers without a DB range error (S1)', async () => {
    const u = await makeUser({ role: 'member' })
    const iss = await createIssue({ actorId: u.id, role: 'member', title: 'real' })
    const refs = await resolveIssueRefs([iss.number, 9999999999, 2147483648])
    expect(refs.map((r) => r.number)).toEqual([iss.number])
  })
})
