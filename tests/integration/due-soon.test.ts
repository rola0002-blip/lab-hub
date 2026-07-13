import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeIssue, seedSystem } from '../factories'
import { pingDueSoonIssues } from '@/lib/jobs'
import { setDueDate } from '@/features/issues/issue-service'
import { COLOSSUS_BOT_ID } from '@/features/bot'

// The message_dm bell lands a few DB round-trips after the (fire-and-forget) fanout
// dispatched by the unsuppressed bot DM — poll for it rather than assert synchronously
// (Tasks 8/10 settle-barrier idiom).
const until = async (fn: () => Promise<boolean>, ms = 2000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((r) => setTimeout(r, 15)) }
}

describe('issue due-soon job', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  const dmCount = async (userId: string) => {
    const dm = await prisma.conversation.findFirst({ where: { type: 'DM', members: { some: { userId } } } })
    return dm ? prisma.message.count({ where: { conversationId: dm.id, userId: COLOSSUS_BOT_ID } }) : 0
  }

  it('DMs the assignee once for an issue due within 24h, then never again', async () => {
    const u = await makeUser()
    const soon = new Date(Date.now() + 3 * 3_600_000)
    const i = await makeIssue(u.id, { assigneeId: u.id, dueDate: soon, status: 'TODO' })
    expect(await pingDueSoonIssues()).toBe(1)
    expect(await dmCount(u.id)).toBe(1)
    // Due-soon has no native notification: the normal DM fan-out is the single ping.
    // Prove the message_dm bell actually lands (settle-barrier), not just the row.
    await until(async () => (await prisma.notification.count({ where: { userId: u.id, type: 'message_dm' } })) === 1)
    expect(await prisma.notification.count({ where: { userId: u.id, type: 'message_dm' } })).toBe(1)
    const after = await prisma.issue.findUniqueOrThrow({ where: { id: i.id } })
    expect(after.dueSoonPingedAt).not.toBeNull()
    expect(await pingDueSoonIssues()).toBe(0) // fires once
    expect(await dmCount(u.id)).toBe(1)
  })

  it('skips unassigned, DONE/CANCELED, overdue, and far-future issues', async () => {
    const u = await makeUser()
    const soon = new Date(Date.now() + 3 * 3_600_000)
    await makeIssue(u.id, { dueDate: soon, status: 'TODO' })                        // unassigned
    await makeIssue(u.id, { assigneeId: u.id, dueDate: soon, status: 'DONE' })       // done
    await makeIssue(u.id, { assigneeId: u.id, dueDate: soon, status: 'CANCELED' })   // canceled
    await makeIssue(u.id, { assigneeId: u.id, dueDate: new Date(Date.now() - 3_600_000), status: 'TODO' }) // overdue (past due) — not pinged
    await makeIssue(u.id, { assigneeId: u.id, dueDate: new Date(Date.now() + 5 * 86_400_000), status: 'TODO' }) // far
    expect(await pingDueSoonIssues()).toBe(0)
  })

  it('re-arms the ping when the due date changes', async () => {
    const u = await makeUser()
    const soon = new Date(Date.now() + 3 * 3_600_000)
    const i = await makeIssue(u.id, { assigneeId: u.id, dueDate: soon, status: 'TODO' })
    await pingDueSoonIssues()
    await setDueDate({ actorId: u.id, role: 'member', issueId: i.id, dueDate: new Date(Date.now() + 4 * 3_600_000) })
    const reset = await prisma.issue.findUniqueOrThrow({ where: { id: i.id } })
    expect(reset.dueSoonPingedAt).toBeNull()   // re-armed
    expect(await pingDueSoonIssues()).toBe(1)  // fires again for the new date
  })
})
