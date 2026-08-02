import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeProject, makeIssue, seedSystem } from '../factories'
import { promptProjectUpdates } from '@/lib/jobs'
import { notificationHref } from '@/lib/notification-href'
import { COLOSSUS_BOT_ID } from '@/features/bot'

const WED = new Date('2026-07-22T09:00:00Z') // Wed 17:00 SGT — past the 16:00 prompt hour

async function seedOrg() {
  await prisma.organization.create({ data: { name: 'Lab', timezone: 'Asia/Singapore', updatePromptDay: 3, updatePromptHour: 16, setupComplete: true } })
}
const botDmTo = async (userId: string) => {
  const dm = await prisma.conversation.findFirst({ where: { type: 'DM', members: { some: { userId } } } })
  return dm ? prisma.message.findMany({ where: { conversationId: dm.id, userId: COLOSSUS_BOT_ID } }) : []
}

describe('promptProjectUpdates (SP8 §4.3–§4.5)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem(); await seedOrg() })

  it('delivery contract: one suppressed DM, one project_update_prompt bell resolving to the DM, ZERO outbox rows; latched; second run sends nothing', async () => {
    const lead = await makeUser()
    const p = await makeProject({ leadId: lead.id, name: 'CVD line' })
    expect(await promptProjectUpdates(WED)).toBe(1)
    const dms = await botDmTo(lead.id)
    expect(dms.length).toBe(1)
    expect(dms[0].body).toContain('CVD line')
    const notifs = await prisma.notification.findMany({ where: { userId: lead.id, type: 'project_update_prompt' } })
    expect(notifs.length).toBe(1)
    expect(notificationHref({ type: notifs[0].type, payload: notifs[0].payload as Record<string, string> }))
      .toBe(`/chat/${dms[0].conversationId}?msg=${dms[0].id}`)
    expect(await prisma.notification.count({ where: { userId: lead.id, type: 'message_dm' } })).toBe(0) // suppressed
    expect(await prisma.emailOutbox.count()).toBe(0)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).lastUpdatePromptAt).not.toBeNull()
    expect(await promptProjectUpdates(WED)).toBe(0)
    expect((await botDmTo(lead.id)).length).toBe(1)
  })
  it('returns 0 off prompt-day and before the prompt hour', async () => {
    const lead = await makeUser()
    await makeProject({ leadId: lead.id })
    expect(await promptProjectUpdates(new Date('2026-07-21T09:00:00Z'))).toBe(0) // Tuesday
    expect(await promptProjectUpdates(new Date('2026-07-22T07:00:00Z'))).toBe(0) // Wed 15:00 SGT < 16:00
  })
  it('skips PAUSED/COMPLETED projects and a future-paused project; pausedUntil <= now prompts', async () => {
    const lead = await makeUser()
    await makeProject({ leadId: lead.id, status: 'PAUSED' })
    await makeProject({ leadId: lead.id, status: 'COMPLETED' })
    await makeProject({ leadId: lead.id, updatePromptsPausedUntil: new Date('2026-08-01T00:00:00Z') })
    const due = await makeProject({ leadId: lead.id, updatePromptsPausedUntil: WED })
    expect(await promptProjectUpdates(WED)).toBe(1)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: due.id } })).lastUpdatePromptAt).not.toBeNull()
  })
  it('banned/guest lead falls through to open-issue assignees, then admins; zero-recipient projects still latch', async () => {
    const banned = await makeUser({ banned: true })
    const assignee = await makeUser()
    const p1 = await makeProject({ leadId: banned.id })
    await makeIssue(assignee.id, { projectId: p1.id, assigneeId: assignee.id, status: 'IN_PROGRESS' })
    const admin = await makeUser({ role: 'admin' })
    const guest = await makeUser({ role: 'guest' })
    const p2 = await makeProject({ leadId: guest.id }) // no open-issue assignees → admins
    const p3 = await makeProject()                     // no lead, no issues → admins
    expect(await promptProjectUpdates(WED)).toBe(3)
    expect((await botDmTo(assignee.id)).length).toBe(1)  // p1 fallback
    expect((await botDmTo(guest.id)).length).toBe(0)     // guests never prompted
    expect((await botDmTo(admin.id)).length).toBe(2)     // p2 + p3
    for (const p of [p1, p2, p3]) {
      expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).lastUpdatePromptAt).not.toBeNull()
    }
  })
  it('digest counts closed-since-window, overdue and stalled issues', async () => {
    const lead = await makeUser()
    const p = await makeProject({ leadId: lead.id })
    const DAY = 86_400_000
    await makeIssue(lead.id, { projectId: p.id, status: 'DONE', completedAt: new Date(+WED - 2 * DAY) })
    await makeIssue(lead.id, { projectId: p.id, status: 'TODO', dueDate: new Date(+WED - 3 * DAY) })
    const st = await makeIssue(lead.id, { projectId: p.id, status: 'IN_PROGRESS' })
    await prisma.issueActivity.updateMany({ where: { issueId: st.id }, data: { createdAt: new Date(+WED - 20 * DAY) } })
    // makeIssue writes no activity — backdate via a manual one:
    await prisma.issueActivity.create({ data: { issueId: st.id, actorId: lead.id, type: 'created', data: {}, createdAt: new Date(+WED - 20 * DAY) } })
    // The digest derives "untouched" from the same lastTouchedByIssue helper as the
    // stalled chip: a DELETED comment is not a touch (st stays counted)…
    const gone = await prisma.issueComment.create({ data: { issueId: st.id, userId: lead.id, body: 'oops', createdAt: new Date(+WED - DAY) } })
    await prisma.issueComment.update({ where: { id: gone.id }, data: { deletedAt: new Date(+WED - DAY) } })
    // …while a live one is, so this equally-old started issue is NOT counted.
    const cm = await makeIssue(lead.id, { projectId: p.id, status: 'IN_REVIEW' })
    await prisma.issueActivity.create({ data: { issueId: cm.id, actorId: lead.id, type: 'created', data: {}, createdAt: new Date(+WED - 20 * DAY) } })
    await prisma.issueComment.create({ data: { issueId: cm.id, userId: lead.id, body: 'still on it', createdAt: new Date(+WED - DAY) } })
    await promptProjectUpdates(WED)
    const [dm] = await botDmTo(lead.id)
    expect(dm.body).toContain('1 issue closed')
    expect(dm.body).toContain('1 overdue')
    expect(dm.body).toContain('1 started but untouched')
  })
})
