import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeProject } from '../factories'
import {
  createIssue, setStatus, setAssignee, setTitle, setLabels, moveIssue, listIssues, createLabel,
  setPriority, setProject, setDueDate, updateDescription, attachIssueFiles, getIssue, getIssueDetail, listLabels,
} from '@/features/issues/issue-service'
import { PolicyError } from '@/features/issues/issue-policy'
import { REBALANCE_THRESHOLD } from '@/features/issues/rank'

async function activities(issueId: string) {
  return prisma.issueActivity.findMany({ where: { issueId }, orderBy: { createdAt: 'asc' } })
}

describe('issue-service', () => {
  beforeEach(resetDb)

  it('creates with LAB identifier, initial rank, a "created" activity, and notifies an assignee', async () => {
    const me = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })
    const iss = await createIssue({ actorId: me.id, role: 'member', title: 'Calibrate SEM', assigneeId: other.id })
    expect(iss.identifier).toBe(`LAB-${iss.number}`)
    expect(iss.rank.length).toBeGreaterThan(0)
    const acts = await activities(iss.id)
    expect(acts.map((a) => a.type)).toEqual(['created'])
    // assignee (≠ creator) gets an issue_assigned notification
    const notif = await prisma.notification.findFirst({ where: { userId: other.id, type: 'issue_assigned' } })
    expect(notif).not.toBeNull()
  })

  it('mention-wins on create: an assignee also @-mentioned gets one issue_mention, not issue_assigned (S6)', async () => {
    const me = await makeUser({ role: 'member' })
    const both = await makeUser({ role: 'member' }) // assignee AND mentioned in the description
    await createIssue({ actorId: me.id, role: 'member', title: 'Overlap', assigneeId: both.id, description: `please handle <@${both.id}>` })
    expect(await prisma.notification.count({ where: { userId: both.id, type: 'issue_mention' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: both.id, type: 'issue_assigned' } })).toBe(0)
    // Control: an assignee who is NOT mentioned still gets issue_assigned, and only that.
    const assignee = await makeUser({ role: 'member' })
    await createIssue({ actorId: me.id, role: 'member', title: 'Plain', assigneeId: assignee.id })
    expect(await prisma.notification.count({ where: { userId: assignee.id, type: 'issue_assigned' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: assignee.id, type: 'issue_mention' } })).toBe(0)
  })

  it('assigns unique COL numbers under concurrent creates (Postgres nextval)', async () => {
    const me = await makeUser({ role: 'member' })
    const created = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      createIssue({ actorId: me.id, role: 'member', title: `concurrent ${i}` })))
    const numbers = created.map((c) => c.number)
    expect(new Set(numbers).size).toBe(12) // no duplicates despite the race
  })

  it('blocks guest mutations with a typed 403', async () => {
    const g = await makeUser({ role: 'guest' })
    await expect(createIssue({ actorId: g.id, role: 'guest', title: 'x' })).rejects.toBeInstanceOf(PolicyError)
  })

  it('writes exactly one activity row per field mutation, in-transaction', async () => {
    const me = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })
    const label = await createLabel({ actorId: me.id, role: 'member', name: 'urgent', color: '--status-in-progress' })
    const iss = await createIssue({ actorId: me.id, role: 'member', title: 'Order argon' })
    await setStatus({ actorId: me.id, role: 'member', issueId: iss.id, status: 'IN_PROGRESS' })
    await setAssignee({ actorId: me.id, role: 'member', issueId: iss.id, assigneeId: other.id })
    await setTitle({ actorId: me.id, role: 'member', issueId: iss.id, title: 'Order argon cylinders' })
    await setLabels({ actorId: me.id, role: 'member', issueId: iss.id, labelIds: [label.id] })
    expect((await activities(iss.id)).map((a) => a.type)).toEqual(['created', 'status', 'assignee', 'title', 'labels'])
  })

  it('marks completedAt + notifies issue_done when someone else completes your issue', async () => {
    const creator = await makeUser({ role: 'member' })
    const closer = await makeUser({ role: 'member' })
    const iss = await createIssue({ actorId: creator.id, role: 'member', title: 'Anneal' })
    await setStatus({ actorId: closer.id, role: 'member', issueId: iss.id, status: 'DONE' })
    const row = await prisma.issue.findUnique({ where: { id: iss.id } })
    expect(row?.completedAt).not.toBeNull()
    expect(await prisma.notification.findFirst({ where: { userId: creator.id, type: 'issue_done' } })).not.toBeNull()
    // No self-notify when the creator closes their own.
    const own = await createIssue({ actorId: creator.id, role: 'member', title: 'Self' })
    await setStatus({ actorId: creator.id, role: 'member', issueId: own.id, status: 'DONE' })
    expect(await prisma.notification.count({ where: { userId: creator.id, type: 'issue_done', payload: { path: ['issueId'], equals: own.id } } })).toBe(0)
  })

  it('board move re-ranks within a column and changes status across, keeping order', async () => {
    const me = await makeUser({ role: 'member' })
    const a = await createIssue({ actorId: me.id, role: 'member', title: 'A', status: 'TODO' })
    await createIssue({ actorId: me.id, role: 'member', title: 'B', status: 'TODO' }) // stays at column bottom
    const c = await createIssue({ actorId: me.id, role: 'member', title: 'C', status: 'TODO' })
    // Move C to the top of TODO (above A).
    await moveIssue({ actorId: me.id, role: 'member', issueId: c.id, status: 'TODO', prevId: null, nextId: a.id })
    const todo = await listIssues({ status: 'TODO' })
    expect(todo.map((i) => i.title)).toEqual(['C', 'A', 'B'])
    // Move A across to IN_PROGRESS (status change writes a 'status' activity).
    await moveIssue({ actorId: me.id, role: 'member', issueId: a.id, status: 'IN_PROGRESS', prevId: null, nextId: null })
    expect((await listIssues({ status: 'IN_PROGRESS' })).map((i) => i.title)).toEqual(['A'])
    expect((await activities(a.id)).map((x) => x.type)).toContain('status')
  })

  it('self-heals via column rebalance when fractional precision is exhausted', async () => {
    const me = await makeUser({ role: 'member' })
    // Pathologically deep adjacent keys: splitting them yields a key longer than
    // REBALANCE_THRESHOLD, forcing moveIssue through rebalanceAndPlace.
    const deep = 'V' + '0'.repeat(60)
    const a = await prisma.issue.create({ data: { title: 'A', creatorId: me.id, status: 'TODO', rank: `${deep}1` } })
    const b = await prisma.issue.create({ data: { title: 'B', creatorId: me.id, status: 'TODO', rank: `${deep}2` } })
    const c = await prisma.issue.create({ data: { title: 'C', creatorId: me.id, status: 'TODO', rank: 'k' } })
    await moveIssue({ actorId: me.id, role: 'member', issueId: c.id, status: 'TODO', prevId: a.id, nextId: b.id })
    const rows = await prisma.issue.findMany({ where: { status: 'TODO' }, orderBy: { rank: 'asc' }, select: { title: true, rank: true } })
    expect(rows.map((r) => r.title)).toEqual(['A', 'C', 'B']) // C landed between its neighbours
    expect(new Set(rows.map((r) => r.rank)).size).toBe(3) // all ranks distinct
    expect(Math.max(...rows.map((r) => r.rank.length))).toBeLessThan(REBALANCE_THRESHOLD) // whole column reseated short
  })

  it('getIssue returns the dto or null; listLabels is name-sorted', async () => {
    const me = await makeUser({ role: 'member' })
    expect(await getIssue('does-not-exist')).toBeNull()
    const iss = await createIssue({ actorId: me.id, role: 'member', title: 'Read me' })
    const got = await getIssue(iss.id)
    expect(got?.id).toBe(iss.id)
    expect(got?.identifier).toBe(`LAB-${iss.number}`)
    await createLabel({ actorId: me.id, role: 'member', name: 'zeta', color: '--status-todo' })
    await createLabel({ actorId: me.id, role: 'member', name: 'alpha', color: '--status-todo' })
    expect((await listLabels()).map((l) => l.name)).toEqual(['alpha', 'zeta'])
  })

  it('creates with labels attached and rejects an out-of-range title or label name', async () => {
    const me = await makeUser({ role: 'member' })
    const label = await createLabel({ actorId: me.id, role: 'member', name: 'blocker', color: '--status-todo' })
    const iss = await createIssue({ actorId: me.id, role: 'member', title: 'Tagged', labelIds: [label.id] })
    expect(iss.labels.map((l) => l.name)).toEqual(['blocker'])
    await expect(createIssue({ actorId: me.id, role: 'member', title: '   ' })).rejects.toBeInstanceOf(PolicyError)
    await expect(createIssue({ actorId: me.id, role: 'member', title: 'x'.repeat(201) })).rejects.toBeInstanceOf(PolicyError)
    await expect(createLabel({ actorId: me.id, role: 'member', name: '  ', color: '--status-todo' })).rejects.toBeInstanceOf(PolicyError)
  })

  it('priority, project and dueDate each write exactly one typed activity row', async () => {
    const me = await makeUser({ role: 'member' })
    const project = await makeProject()
    const iss = await createIssue({ actorId: me.id, role: 'member', title: 'Configure' })
    await setPriority({ actorId: me.id, role: 'member', issueId: iss.id, priority: 'HIGH' })
    await setProject({ actorId: me.id, role: 'member', issueId: iss.id, projectId: project.id })
    const due = new Date('2026-08-01T00:00:00.000Z')
    await setDueDate({ actorId: me.id, role: 'member', issueId: iss.id, dueDate: due })
    expect((await activities(iss.id)).map((a) => a.type)).toEqual(['created', 'priority', 'project', 'due_date'])
    const row = await getIssue(iss.id)
    expect(row?.priority).toBe('HIGH')
    expect(row?.project?.id).toBe(project.id)
    expect(row?.dueDate).toBe(due.toISOString())
  })

  it('filters by due-date range (overdue / this week) in the org zone, composing with status', async () => {
    const me = await makeUser({ role: 'member' })
    const now = new Date('2026-07-22T02:00:00Z') // Wed 2026-07-22, 10:00 SGT; week = Mon 07-20 .. Sun 07-26
    await createIssue({ actorId: me.id, role: 'member', title: 'past', dueDate: new Date('2026-07-19T00:00:00Z') })   // overdue
    const today = await createIssue({ actorId: me.id, role: 'member', title: 'today', dueDate: new Date('2026-07-22T00:00:00Z') }) // this week
    await createIssue({ actorId: me.id, role: 'member', title: 'sun', dueDate: new Date('2026-07-26T00:00:00Z') })   // this week (Sunday)
    await createIssue({ actorId: me.id, role: 'member', title: 'next', dueDate: new Date('2026-07-30T00:00:00Z') })  // outside the week
    await createIssue({ actorId: me.id, role: 'member', title: 'none' })                                             // no due date

    expect((await listIssues({ due: 'overdue' }, now)).map((i) => i.title)).toEqual(['past'])
    expect((await listIssues({ due: 'week' }, now)).map((i) => i.title).sort()).toEqual(['sun', 'today'])
    // No due filter → every issue (including the one with no due date) is returned.
    expect((await listIssues({}, now)).length).toBe(5)
    // Orthogonal to status: the due filter composes with a status filter, never overrides it.
    await setStatus({ actorId: me.id, role: 'member', issueId: today.id, status: 'IN_PROGRESS' })
    expect((await listIssues({ due: 'week', status: 'IN_PROGRESS' }, now)).map((i) => i.title)).toEqual(['today'])
    expect((await listIssues({ due: 'week', status: 'BACKLOG' }, now)).map((i) => i.title)).toEqual(['sun'])
  })

  it('updateDescription notifies newly-mentioned users, writes no activity, and does not re-notify', async () => {
    const me = await makeUser({ role: 'member' })
    const mentioned = await makeUser({ role: 'member' })
    const iss = await createIssue({ actorId: me.id, role: 'member', title: 'Draft' })
    await updateDescription({ actorId: me.id, role: 'member', issueId: iss.id, description: `ping <@${mentioned.id}>` })
    expect((await activities(iss.id)).map((a) => a.type)).toEqual(['created']) // description edits are never activities
    expect(await prisma.notification.findFirst({ where: { userId: mentioned.id, type: 'issue_mention' } })).not.toBeNull()
    // Re-saving with the same mention already in the baseline does not re-notify.
    await updateDescription({ actorId: me.id, role: 'member', issueId: iss.id, description: `still <@${mentioned.id}>` })
    expect(await prisma.notification.count({ where: { userId: mentioned.id, type: 'issue_mention' } })).toBe(1)
  })

  it('attaches files and surfaces them via getIssueDetail; empty attach is a no-op', async () => {
    const me = await makeUser({ role: 'member' })
    const iss = await createIssue({ actorId: me.id, role: 'member', title: 'With files' })
    // Happy path: a server-generated issues upload path (saveUpload output shape).
    await attachIssueFiles({ actorId: me.id, role: 'member', issueId: iss.id, files: [{ path: '/uploads/issues/1f2e3d4c-0000-4000-8000-000000000001.pdf', name: 'a.pdf', mime: 'application/pdf', size: 10 }] })
    const detail = await getIssueDetail(iss.id)
    expect(detail?.attachments.map((f) => f.name)).toEqual(['a.pdf'])
    expect(detail?.issue.id).toBe(iss.id)
    const after = await attachIssueFiles({ actorId: me.id, role: 'member', issueId: iss.id, files: [] }) // no-op branch
    expect(after.id).toBe(iss.id)
    expect(await getIssueDetail('missing')).toBeNull()
  })

  it('rejects non-issues upload paths in attachIssueFiles (cross-feature file-reference IDOR)', async () => {
    const me = await makeUser({ role: 'member' })
    const iss = await createIssue({ actorId: me.id, role: 'member', title: 'Hardened' })
    // A foreign uploads-tree path (another feature's file) must not be attachable.
    await expect(attachIssueFiles({
      actorId: me.id, role: 'member', issueId: iss.id,
      files: [{ path: '/uploads/chat/x.pdf', name: 'x.pdf', mime: 'application/pdf', size: 5 }],
    })).rejects.toMatchObject({ name: 'PolicyError', code: 'invalid' })
    // Traversal is rejected even under the issues prefix (belt-and-braces).
    await expect(attachIssueFiles({
      actorId: me.id, role: 'member', issueId: iss.id,
      files: [{ path: '/uploads/issues/../avatars/victim.png', name: 'v.png', mime: 'image/png', size: 5 }],
    })).rejects.toMatchObject({ name: 'PolicyError', code: 'invalid' })
    // One bad path poisons the whole batch: nothing is persisted.
    await expect(attachIssueFiles({
      actorId: me.id, role: 'member', issueId: iss.id,
      files: [
        { path: '/uploads/issues/ok-0000-4000-8000-000000000002.pdf', name: 'ok.pdf', mime: 'application/pdf', size: 5 },
        { path: '/uploads/avatars/victim.png', name: 'v.png', mime: 'image/png', size: 5 },
      ],
    })).rejects.toMatchObject({ name: 'PolicyError', code: 'invalid' })
    expect(await prisma.issueAttachment.count({ where: { issueId: iss.id } })).toBe(0)
  })

  it('no-op status / assignee changes short-circuit without a new activity', async () => {
    const me = await makeUser({ role: 'member' })
    const iss = await createIssue({ actorId: me.id, role: 'member', title: 'Idle', status: 'TODO' })
    await setStatus({ actorId: me.id, role: 'member', issueId: iss.id, status: 'TODO' }) // same status
    await setAssignee({ actorId: me.id, role: 'member', issueId: iss.id, assigneeId: null }) // already unassigned
    expect((await activities(iss.id)).map((a) => a.type)).toEqual(['created'])
  })

  it('self-heals when neighbour ranks are inverted (rankBetween throws → rebalance)', async () => {
    const me = await makeUser({ role: 'member' })
    // Client passed neighbours whose keys are out of order (prev >= next), so
    // rankBetween throws and moveIssue falls through its catch into rebalanceAndPlace.
    const hi = await prisma.issue.create({ data: { title: 'hi', creatorId: me.id, status: 'TODO', rank: 'z' } })
    const lo = await prisma.issue.create({ data: { title: 'lo', creatorId: me.id, status: 'TODO', rank: 'a' } })
    const mv = await prisma.issue.create({ data: { title: 'mv', creatorId: me.id, status: 'TODO', rank: 'm' } })
    await expect(moveIssue({ actorId: me.id, role: 'member', issueId: mv.id, status: 'TODO', prevId: hi.id, nextId: lo.id })).resolves.toBeTruthy()
    const rows = await prisma.issue.findMany({ where: { status: 'TODO' }, select: { title: true, rank: true } })
    expect(new Set(rows.map((r) => r.rank)).size).toBe(3) // all distinct after reseat
    expect(Math.max(...rows.map((r) => r.rank.length))).toBeLessThan(REBALANCE_THRESHOLD)
  })

  it('guests are blocked from every mutation; missing issues raise not_found', async () => {
    const owner = await makeUser({ role: 'member' })
    const guest = await makeUser({ role: 'guest' })
    const iss = await createIssue({ actorId: owner.id, role: 'member', title: 'Locked' })
    await expect(setStatus({ actorId: guest.id, role: 'guest', issueId: iss.id, status: 'DONE' })).rejects.toBeInstanceOf(PolicyError)
    await expect(setTitle({ actorId: guest.id, role: 'guest', issueId: iss.id, title: 'nope' })).rejects.toBeInstanceOf(PolicyError)
    await expect(updateDescription({ actorId: guest.id, role: 'guest', issueId: iss.id, description: 'x' })).rejects.toBeInstanceOf(PolicyError)
    await expect(attachIssueFiles({ actorId: guest.id, role: 'guest', issueId: iss.id, files: [] })).rejects.toBeInstanceOf(PolicyError)
    await expect(createLabel({ actorId: guest.id, role: 'guest', name: 'x', color: '--status-todo' })).rejects.toBeInstanceOf(PolicyError)
    await expect(moveIssue({ actorId: guest.id, role: 'guest', issueId: iss.id, status: 'TODO' })).rejects.toBeInstanceOf(PolicyError)
    // not_found: a member acting on a non-existent issue
    await expect(setStatus({ actorId: owner.id, role: 'member', issueId: 'ghost', status: 'DONE' })).rejects.toBeInstanceOf(PolicyError)
  })

  it('guest probing a NONEXISTENT issue gets forbidden, never not_found (no existence leak)', async () => {
    const guest = await makeUser({ role: 'guest' })
    // simpleSet family: permission is asserted BEFORE the issue is loaded, so a
    // guest cannot distinguish an existing issue from a missing one.
    await expect(setPriority({ actorId: guest.id, role: 'guest', issueId: 'ghost', priority: 'HIGH' }))
      .rejects.toMatchObject({ name: 'PolicyError', code: 'forbidden' })
    await expect(setProject({ actorId: guest.id, role: 'guest', issueId: 'ghost', projectId: null }))
      .rejects.toMatchObject({ name: 'PolicyError', code: 'forbidden' })
    await expect(setDueDate({ actorId: guest.id, role: 'guest', issueId: 'ghost', dueDate: null }))
      .rejects.toMatchObject({ name: 'PolicyError', code: 'forbidden' })
    // setTitle asserts permission even before title validation (empty title would
    // otherwise leak an `invalid` 400 to a read-only guest).
    await expect(setTitle({ actorId: guest.id, role: 'guest', issueId: 'ghost', title: '' }))
      .rejects.toMatchObject({ name: 'PolicyError', code: 'forbidden' })
  })
})
