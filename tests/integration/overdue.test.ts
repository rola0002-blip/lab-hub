import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeIssue, seedSystem } from '../factories'
import { pingOverdueIssues } from '@/lib/jobs'
import { setDueDate } from '@/features/issues/issue-service'
import { COLOSSUS_BOT_ID } from '@/features/bot'

// The message_dm bell lands a few DB round-trips after the (fire-and-forget) fanout
// dispatched by the unsuppressed bot DM — poll for it rather than assert synchronously
// (mirrors the due-soon test's settle barrier).
const until = async (fn: () => Promise<boolean>, ms = 2000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)) }
}

const DAY = 86_400_000

describe('issue overdue job', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  const dmCount = async (userId: string) => {
    const dm = await prisma.conversation.findFirst({ where: { type: 'DM', members: { some: { userId } } } })
    return dm ? prisma.message.count({ where: { conversationId: dm.id, userId: COLOSSUS_BOT_ID } }) : 0
  }

  it('DMs the assignee once when an open issue is past due, then never again', async () => {
    const u = await makeUser()
    const i = await makeIssue(u.id, { assigneeId: u.id, dueDate: new Date(Date.now() - 2 * DAY), status: 'IN_PROGRESS' })
    expect(await pingOverdueIssues()).toBe(1)
    expect(await dmCount(u.id)).toBe(1)
    // Overdue has no native notification: the normal DM fan-out is the single ping.
    // Prove the message_dm bell actually lands (settle-barrier), not just the row.
    await until(async () => (await prisma.notification.count({ where: { userId: u.id, type: 'message_dm' } })) === 1)
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'message_dm' } })).toBe(1)
    const after = await prisma.issue.findUniqueOrThrow({ where: { id: i.id } })
    expect(after.overduePingedAt).not.toBeNull()
    expect(await pingOverdueIssues()).toBe(0) // fires once
    expect(await dmCount(u.id)).toBe(1)
  })

  it('skips unassigned, DONE/CANCELED, due-today, and future issues', async () => {
    const u = await makeUser()
    const past = new Date(Date.now() - 2 * DAY)
    await makeIssue(u.id, { dueDate: past, status: 'TODO' })                          // unassigned
    await makeIssue(u.id, { assigneeId: u.id, dueDate: past, status: 'DONE' })         // done
    await makeIssue(u.id, { assigneeId: u.id, dueDate: past, status: 'CANCELED' })     // canceled
    await makeIssue(u.id, { assigneeId: u.id, dueDate: new Date(), status: 'TODO' })   // due today — not yet overdue
    await makeIssue(u.id, { assigneeId: u.id, dueDate: new Date(Date.now() + 5 * DAY), status: 'TODO' }) // future
    expect(await pingOverdueIssues()).toBe(0)
  })

  it('honours an injected clock: not overdue before the due day, overdue after (flag = injected now)', async () => {
    const u = await makeUser()
    const i = await makeIssue(u.id, { assigneeId: u.id, dueDate: new Date('2026-07-10T00:00:00Z'), status: 'TODO' })
    // Before the due day (org zone) → nothing fires, flag stays null.
    expect(await pingOverdueIssues(new Date('2026-07-05T00:00:00Z'))).toBe(0)
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: i.id } })).overduePingedAt).toBeNull()
    // After the due day → fires once and stamps the injected now.
    const now = new Date('2026-07-15T02:00:00Z')
    expect(await pingOverdueIssues(now)).toBe(1)
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: i.id } })).overduePingedAt?.toISOString()).toBe(now.toISOString())
  })

  it('re-arms the overdue ping when the due date changes', async () => {
    const u = await makeUser()
    const i = await makeIssue(u.id, { assigneeId: u.id, dueDate: new Date(Date.now() - 5 * DAY), status: 'TODO' })
    await pingOverdueIssues()
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: i.id } })).overduePingedAt).not.toBeNull()
    // Moving the due date (still in the past) clears the flag → the job pings again.
    await setDueDate({ actorId: u.id, role: 'member', issueId: i.id, dueDate: new Date(Date.now() - 3 * DAY) })
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: i.id } })).overduePingedAt).toBeNull() // re-armed
    expect(await pingOverdueIssues()).toBe(1)
    expect(await dmCount(u.id)).toBe(2)
  })
})
