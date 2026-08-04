import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeIssue, makeIssueComment, makeLabel, makeProject, seedSystem } from '../factories'
import { createIssue, deleteIssue, attachIssueFiles } from '@/features/issues/issue-service'
import { PolicyError } from '@/features/issues/issue-policy'
import { saveUpload, uploadsDir } from '@/lib/uploads'
import { LAB_UPDATES_CHANNEL_ID } from '@/features/bot'

const diskPath = (publicPath: string) =>
  path.join(uploadsDir(), ...publicPath.replace(/^\/uploads\//, '').split('/'))

const rejects = (p: Promise<unknown>, code: PolicyError['code']) =>
  p.then(() => { throw new Error('should have thrown') },
    (e) => { expect(e).toBeInstanceOf(PolicyError); expect((e as PolicyError).code).toBe(code) })

describe('deleteIssue (v0.11 §4)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('the creator (a member) can delete, and every child row goes with it', async () => {
    const me = await makeUser({ role: 'member' })
    const project = await makeProject()
    const label = await makeLabel()
    const issue = await createIssue({ actorId: me.id, role: 'member', title: 'Calibrate the SEM', projectId: project.id, labelIds: [label.id] })
    await makeIssueComment(issue.id, me.id)

    // Pre-conditions: all four child tables are populated.
    expect(await prisma.issueLabel.count({ where: { issueId: issue.id } })).toBe(1)
    expect(await prisma.issueComment.count({ where: { issueId: issue.id } })).toBe(1)
    expect(await prisma.issueActivity.count({ where: { issueId: issue.id } })).toBeGreaterThan(0)

    await deleteIssue({ issueId: issue.id, actorId: me.id, role: 'member' })

    expect(await prisma.issue.findUnique({ where: { id: issue.id } })).toBeNull()
    expect(await prisma.issueLabel.count({ where: { issueId: issue.id } })).toBe(0)
    expect(await prisma.issueComment.count({ where: { issueId: issue.id } })).toBe(0)
    expect(await prisma.issueAttachment.count({ where: { issueId: issue.id } })).toBe(0)
    expect(await prisma.issueActivity.count({ where: { issueId: issue.id } })).toBe(0)
    // The project itself survives — only the issue is destroyed.
    expect(await prisma.project.findUnique({ where: { id: project.id } })).not.toBeNull()
  })

  it('unlinks every attachment file from the uploads dir', async () => {
    const me = await makeUser({ role: 'member' })
    const issue = await createIssue({ actorId: me.id, role: 'member', title: 'With attachments' })
    const p1 = await saveUpload(new File([new Uint8Array(64)], 'a.png', { type: 'image/png' }), 'issues')
    const p2 = await saveUpload(new File([new Uint8Array(64)], 'b.png', { type: 'image/png' }), 'issues')
    await attachIssueFiles({ actorId: me.id, role: 'member', issueId: issue.id, files: [
      { path: p1, name: 'a.png', mime: 'image/png', size: 64 },
      { path: p2, name: 'b.png', mime: 'image/png', size: 64 },
    ] })
    expect(existsSync(diskPath(p1))).toBe(true)
    expect(existsSync(diskPath(p2))).toBe(true)

    await deleteIssue({ issueId: issue.id, actorId: me.id, role: 'member' })

    expect(existsSync(diskPath(p1))).toBe(false)
    expect(existsSync(diskPath(p2))).toBe(false)
  })

  it('a file already missing from disk does not fail the call', async () => {
    const me = await makeUser({ role: 'member' })
    const issue = await makeIssue(me.id)
    await prisma.issueAttachment.create({ data: { issueId: issue.id, uploaderId: me.id, path: '/uploads/issues/ghost.png', name: 'ghost.png', mime: 'image/png', size: 1 } })
    await deleteIssue({ issueId: issue.id, actorId: me.id, role: 'member' })
    expect(await prisma.issue.findUnique({ where: { id: issue.id } })).toBeNull()
  })

  it('an admin can delete an issue they did not create', async () => {
    const author = await makeUser({ role: 'member' })
    const admin = await makeUser({ role: 'admin' })
    const issue = await makeIssue(author.id)
    await deleteIssue({ issueId: issue.id, actorId: admin.id, role: 'admin' })
    expect(await prisma.issue.findUnique({ where: { id: issue.id } })).toBeNull()
  })

  it('a non-creator member and a guest are forbidden; the issue survives', async () => {
    const author = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })
    const guest = await makeUser({ role: 'guest' })
    const issue = await makeIssue(author.id)
    await rejects(deleteIssue({ issueId: issue.id, actorId: other.id, role: 'member' }), 'forbidden')
    await rejects(deleteIssue({ issueId: issue.id, actorId: guest.id, role: 'guest' }), 'forbidden')
    // Even the creator loses it once demoted to guest — the delete is hard and cascading.
    await rejects(deleteIssue({ issueId: issue.id, actorId: author.id, role: 'guest' }), 'forbidden')
    expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull()
  })

  it('a forged or already-deleted id is not_found (404), never forbidden', async () => {
    const me = await makeUser({ role: 'member' })
    await rejects(deleteIssue({ issueId: 'ghost', actorId: me.id, role: 'member' }), 'not_found')
    const issue = await makeIssue(me.id)
    await deleteIssue({ issueId: issue.id, actorId: me.id, role: 'member' })
    await rejects(deleteIssue({ issueId: issue.id, actorId: me.id, role: 'member' }), 'not_found')
  })

  it('is SILENT — nothing is posted to #lab-updates by the delete', async () => {
    const me = await makeUser({ role: 'member' })
    const issue = await createIssue({ actorId: me.id, role: 'member', title: 'Announce me once' })
    // createIssue's own announce is fire-and-forget; settle before counting.
    await new Promise((r) => setTimeout(r, 300))
    const before = await prisma.message.count({ where: { conversationId: LAB_UPDATES_CHANNEL_ID } })
    await deleteIssue({ issueId: issue.id, actorId: me.id, role: 'member' })
    await new Promise((r) => setTimeout(r, 300))
    expect(await prisma.message.count({ where: { conversationId: LAB_UPDATES_CHANNEL_ID } })).toBe(before)
  })
})
