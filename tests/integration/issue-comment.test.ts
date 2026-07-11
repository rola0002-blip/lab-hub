import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { createIssue } from '@/features/issues/issue-service'
import { createComment, editComment, deleteComment, listTimeline } from '@/features/issues/comment-service'
import { PolicyError } from '@/features/issues/issue-policy'

describe('comment-service', () => {
  beforeEach(resetDb)

  it('notifies issue_comment to creator+assignee (excl self) and issue_mention to mentioned', async () => {
    const creator = await makeUser({ role: 'member' })
    const assignee = await makeUser({ role: 'member' })
    const commenter = await makeUser({ role: 'member' })
    const mentioned = await makeUser({ role: 'member' })
    const iss = await createIssue({ actorId: creator.id, role: 'member', title: 'Repair', assigneeId: assignee.id })
    await createComment({ actorId: commenter.id, role: 'member', issueId: iss.id, body: `on it <@${mentioned.id}>` })
    // creator + assignee get issue_comment; commenter (self) does not.
    expect(await prisma.notification.count({ where: { type: 'issue_comment', userId: { in: [creator.id, assignee.id] } } })).toBe(2)
    expect(await prisma.notification.count({ where: { type: 'issue_comment', userId: commenter.id } })).toBe(0)
    // mentioned user gets issue_mention (not a duplicate issue_comment).
    expect(await prisma.notification.count({ where: { type: 'issue_mention', userId: mentioned.id } })).toBe(1)
  })

  it('de-dupes: a user who is both mentioned AND the assignee gets exactly one issue_mention', async () => {
    const creator = await makeUser({ role: 'member' })
    const both = await makeUser({ role: 'member' }) // assignee AND mentioned in the comment
    const commenter = await makeUser({ role: 'member' })
    const iss = await createIssue({ actorId: creator.id, role: 'member', title: 'Overlap', assigneeId: both.id })
    await createComment({ actorId: commenter.id, role: 'member', issueId: iss.id, body: `ping <@${both.id}>` })
    // issue_mention wins over the issue_comment assignee ping — the comment fires
    // exactly one notification for `both` (issue_mention), never a duplicate
    // issue_comment. (The prior issue_assigned from createIssue is unrelated.)
    expect(await prisma.notification.count({ where: { type: 'issue_mention', userId: both.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { type: 'issue_comment', userId: both.id } })).toBe(0)
  })

  it('author-only edit; author-or-admin tombstone delete; timeline merges comments + activity', async () => {
    const author = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })
    const admin = await makeUser({ role: 'admin' })
    const iss = await createIssue({ actorId: author.id, role: 'member', title: 'X' })
    const c = await createComment({ actorId: author.id, role: 'member', issueId: iss.id, body: 'first' })
    await expect(editComment({ actorId: other.id, role: 'member', commentId: c.id, body: 'hack' })).rejects.toBeInstanceOf(PolicyError)
    await editComment({ actorId: author.id, role: 'member', commentId: c.id, body: 'edited' })
    await deleteComment({ actorId: admin.id, role: 'admin', commentId: c.id }) // admin may delete any
    const row = await prisma.issueComment.findUnique({ where: { id: c.id } })
    expect(row?.deletedAt).not.toBeNull()
    const timeline = await listTimeline(iss.id)
    expect(timeline.some((e) => e.kind === 'activity' && e.type === 'created')).toBe(true)
    expect(timeline.some((e) => e.kind === 'comment')).toBe(true)
    // entries are chronologically ordered
    const times = timeline.map((e) => e.createdAt)
    expect([...times].sort()).toEqual(times)
  })

  it('blocks guest comments', async () => {
    const g = await makeUser({ role: 'guest' })
    const a = await makeUser({ role: 'member' })
    const iss = await createIssue({ actorId: a.id, role: 'member', title: 'Y' })
    await expect(createComment({ actorId: g.id, role: 'guest', issueId: iss.id, body: 'hi' })).rejects.toBeInstanceOf(PolicyError)
  })
})
