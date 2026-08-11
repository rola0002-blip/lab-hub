import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeProject, makeProjectUpdate, makeIssue, seedSystem } from '../factories'
import {
  postProjectUpdate, listProjectUpdates, editProjectUpdate, deleteProjectUpdate,
} from '@/features/issues/project-update-service'
import { getProject, listProjects } from '@/features/issues/project-service'
import { promptProjectUpdates } from '@/lib/jobs'
import { COLOSSUS_BOT_ID, LAB_UPDATES_CHANNEL_ID } from '@/features/bot'

// Action-level seams (the project-update-service.test.ts pair): a Server Action
// invoked directly under Vitest has no request scope, so both the session read and
// the cache revalidation are stubbed. The service tests are unaffected —
// project-update-service imports `Role` as a type only.
const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: 'admin' | 'member' | 'guest' } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => { if (!mockUser.current) throw new Error('NEXT_REDIRECT'); return mockUser.current },
  requireAdmin: async () => { if (mockUser.current?.role !== 'admin') throw new Error('NEXT_REDIRECT'); return mockUser.current },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { editProjectUpdateAction, deleteProjectUpdateAction } from '@/app/(app)/issues/actions'

const botDmTo = async (userId: string) => {
  const dm = await prisma.conversation.findFirst({ where: { type: 'DM', members: { some: { userId } } } })
  return dm ? prisma.message.findMany({ where: { conversationId: dm.id, userId: COLOSSUS_BOT_ID } }) : []
}

describe('project update edit + soft delete (v0.15 §6)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('the author edits body and health: editedAt is stamped, createdAt is untouched, and nothing is re-announced', async () => {
    const u = await makeUser(); const p = await makeProject()
    const posted = await postProjectUpdate({ projectId: p.id, actorId: u.id, role: 'member', health: 'ON_TRACK', body: 'frist draft' })
    expect(posted.editedAt).toBeNull()
    expect(posted.deleted).toBe(false)

    const edited = await editProjectUpdate({ updateId: posted.id, actorId: u.id, role: 'member', body: '  first draft, corrected  ', health: 'AT_RISK' })
    expect(edited.body).toBe('first draft, corrected')   // trimmed
    expect(edited.health).toBe('AT_RISK')
    expect(edited.editedAt).not.toBeNull()
    expect(edited.deleted).toBe(false)
    expect(edited.createdAt).toBe(posted.createdAt)      // an edit never moves the post instant…

    const feed = await listProjectUpdates(p.id)
    expect(feed.map((x) => x.body)).toEqual(['first draft, corrected'])
    expect(feed[0].editedAt).not.toBeNull()
    // …and "latest" still points at the same row, with the corrected health.
    expect((await getProject(p.id))!.latestUpdate).toMatchObject({ id: posted.id, health: 'AT_RISK', createdAt: posted.createdAt })

    // Silent by design: the #lab-updates line records what was said at the time —
    // one announce from the post, none from the correction, and no bell.
    expect(await prisma.message.count({ where: { conversationId: LAB_UPDATES_CHANNEL_ID } })).toBe(1)
    expect(await prisma.notification.count()).toBe(0)
  })

  it('edit is author-only: another member, an admin who did not write it, and a guest author are all refused', async () => {
    const author = await makeUser(); const other = await makeUser()
    const admin = await makeUser({ role: 'admin' }); const guest = await makeUser({ role: 'guest' })
    const p = await makeProject()
    const up = await makeProjectUpdate(p.id, author.id, { body: 'mine' })
    const guestRow = await makeProjectUpdate(p.id, guest.id, { body: 'theirs' })
    const edit = (actorId: string, role: 'admin' | 'member' | 'guest', updateId = up.id) =>
      editProjectUpdate({ updateId, actorId, role, body: 'rewritten', health: 'OFF_TRACK' })
    await expect(edit(other.id, 'member')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(edit(admin.id, 'admin')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(edit(guest.id, 'guest')).rejects.toMatchObject({ code: 'forbidden' })
    // Even on their OWN row: assertCanMutate runs before the load, so a guest never
    // reaches the author predicate (and never learns whether the row exists).
    await expect(edit(guest.id, 'guest', guestRow.id)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(edit(guest.id, 'guest', 'no-such-update')).rejects.toMatchObject({ code: 'forbidden' })
    expect((await prisma.projectUpdate.findUniqueOrThrow({ where: { id: up.id } })).body).toBe('mine')
  })

  it('edit trims and caps the body at 4000; an empty body is invalid', async () => {
    const u = await makeUser(); const p = await makeProject()
    const up = await makeProjectUpdate(p.id, u.id)
    const long = await editProjectUpdate({ updateId: up.id, actorId: u.id, role: 'member', body: 'y'.repeat(5000), health: 'ON_TRACK' })
    expect(long.body.length).toBe(4000)
    await expect(editProjectUpdate({ updateId: up.id, actorId: u.id, role: 'member', body: '   ', health: 'ON_TRACK' }))
      .rejects.toMatchObject({ code: 'invalid' })
    expect((await prisma.projectUpdate.findUniqueOrThrow({ where: { id: up.id } })).body.length).toBe(4000)
  })

  it('a missing update and an already-deleted one are the same not_found, for both mutations', async () => {
    const u = await makeUser(); const p = await makeProject()
    const up = await makeProjectUpdate(p.id, u.id)
    await expect(editProjectUpdate({ updateId: 'no-such-update', actorId: u.id, role: 'member', body: 'x', health: 'ON_TRACK' }))
      .rejects.toMatchObject({ code: 'not_found' })
    await expect(deleteProjectUpdate({ updateId: 'no-such-update', actorId: u.id, role: 'member' }))
      .rejects.toMatchObject({ code: 'not_found' })
    await deleteProjectUpdate({ updateId: up.id, actorId: u.id, role: 'member' })
    // A tombstone is not editable and not re-deletable — it is gone to every writer.
    await expect(editProjectUpdate({ updateId: up.id, actorId: u.id, role: 'member', body: 'x', health: 'ON_TRACK' }))
      .rejects.toMatchObject({ code: 'not_found' })
    await expect(deleteProjectUpdate({ updateId: up.id, actorId: u.id, role: 'member' }))
      .rejects.toMatchObject({ code: 'not_found' })
  })

  it('a soft delete keeps the row in the feed as an empty tombstone and hands "latest" back to the previous update', async () => {
    const u = await makeUser(); const p = await makeProject()
    const older = await makeProjectUpdate(p.id, u.id, { body: 'week one', health: 'ON_TRACK', createdAt: new Date('2026-08-01T00:00:00Z') })
    const newer = await makeProjectUpdate(p.id, u.id, { body: 'week two', health: 'OFF_TRACK', createdAt: new Date('2026-08-08T00:00:00Z') })
    const card = async () => (await listProjects()).find((x) => x.id === p.id)!
    expect((await getProject(p.id))!.latestUpdate!.id).toBe(newer.id)
    expect((await card()).latestUpdate!.id).toBe(newer.id)

    await deleteProjectUpdate({ updateId: newer.id, actorId: u.id, role: 'member' })

    // The feed is deliberately UNFILTERED: the history is never erased, so the row
    // still rides it as an empty tombstone.
    const feed = await listProjectUpdates(p.id)
    expect(feed.map((x) => [x.id, x.body, x.deleted])).toEqual([[newer.id, '', true], [older.id, 'week one', false]])
    // Health is retained in the row (never rendered) — the delete is a retraction,
    // not a shred.
    expect((await prisma.projectUpdate.findUniqueOrThrow({ where: { id: newer.id } })).health).toBe('OFF_TRACK')

    // Both latest-pick sites fall back: getProject's findFirst AND listProjects'
    // groupBy + its follow-up findMany.
    expect((await getProject(p.id))!.latestUpdate!.id).toBe(older.id)
    expect((await card()).latestUpdate).toMatchObject({ id: older.id, health: 'ON_TRACK' })

    // Deleting the last surviving row leaves the project with no latest at all.
    await deleteProjectUpdate({ updateId: older.id, actorId: u.id, role: 'member' })
    expect((await getProject(p.id))!.latestUpdate).toBeNull()
    expect((await card()).latestUpdate).toBeNull()
    expect(await listProjectUpdates(p.id)).toHaveLength(2)
  })

  it('delete is author-or-admin: an admin may retract anyone’s row, a non-author member may not, guests never', async () => {
    const author = await makeUser(); const other = await makeUser()
    const admin = await makeUser({ role: 'admin' }); const guest = await makeUser({ role: 'guest' })
    const p = await makeProject()
    const [a, b] = [await makeProjectUpdate(p.id, author.id), await makeProjectUpdate(p.id, author.id)]
    await expect(deleteProjectUpdate({ updateId: a.id, actorId: other.id, role: 'member' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(deleteProjectUpdate({ updateId: a.id, actorId: guest.id, role: 'guest' })).rejects.toMatchObject({ code: 'forbidden' })
    await deleteProjectUpdate({ updateId: a.id, actorId: admin.id, role: 'admin' })     // admin, not the author
    await deleteProjectUpdate({ updateId: b.id, actorId: author.id, role: 'member' })   // the author themselves
    const rows = await prisma.projectUpdate.findMany({ where: { projectId: p.id } })
    expect(rows.every((r) => r.deletedAt !== null && r.body === '')).toBe(true)
  })

  it('same-instant tie: deleting the ordering winner hands latest to the surviving twin', async () => {
    const u = await makeUser(); const p = await makeProject()
    const at = new Date('2026-08-08T00:00:00Z')
    const a = await makeProjectUpdate(p.id, u.id, { body: 'A', createdAt: at })
    const b = await makeProjectUpdate(p.id, u.id, { body: 'B', createdAt: at })
    // PROJECT_UPDATE_ORDER is createdAt desc, id desc — with the instants equal the
    // higher id wins, so the group's _max.createdAt is UNCHANGED by the delete and
    // only the follow-up findMany's filter can pick the survivor.
    const [winner, survivor] = [a, b].sort((x, y) => (x.id < y.id ? 1 : -1))
    const card = async () => (await listProjects()).find((x) => x.id === p.id)!
    expect((await getProject(p.id))!.latestUpdate!.id).toBe(winner.id)
    expect((await card()).latestUpdate!.id).toBe(winner.id)

    await deleteProjectUpdate({ updateId: winner.id, actorId: u.id, role: 'member' })
    expect((await getProject(p.id))!.latestUpdate!.id).toBe(survivor.id)
    expect((await card()).latestUpdate!.id).toBe(survivor.id)
  })

  it('the weekly digest window ignores a deleted update: a tombstone can never hide work', async () => {
    await prisma.organization.create({ data: { name: 'Lab', timezone: 'Asia/Singapore', updatePromptDay: 3, updatePromptHour: 16, setupComplete: true } })
    const WED = new Date('2026-07-22T09:00:00Z') // Wed 17:00 SGT — past the 16:00 prompt hour
    const DAY = 86_400_000
    const leadA = await makeUser(); const leadB = await makeUser()
    const pa = await makeProject({ leadId: leadA.id }); const pb = await makeProject({ leadId: leadB.id })
    for (const [p, lead] of [[pa, leadA], [pb, leadB]] as const) {
      await makeIssue(lead.id, { projectId: p.id, status: 'DONE', completedAt: new Date(+WED - 3 * DAY) })
    }
    // A: its only recent update is DELETED → the window falls back to now−7d and the
    // issue closed three days ago is still inside it.
    const gone = await makeProjectUpdate(pa.id, leadA.id, { createdAt: new Date(+WED - DAY) })
    await deleteProjectUpdate({ updateId: gone.id, actorId: leadA.id, role: 'member' })
    // B: identical shape but the update is LIVE → the window starts yesterday and the
    // same issue falls outside it. The pair is the control for the filter.
    await makeProjectUpdate(pb.id, leadB.id, { createdAt: new Date(+WED - DAY) })

    expect(await promptProjectUpdates(WED)).toBe(2)
    expect((await botDmTo(leadA.id))[0].body).toContain('1 issue closed')
    expect((await botDmTo(leadB.id))[0].body).toContain('0 issues closed')
  })

  it('the actions validate their input and run as the signed-in user', async () => {
    const u = await makeUser(); const other = await makeUser(); const p = await makeProject()
    const up = await makeProjectUpdate(p.id, u.id, { body: 'first' })
    mockUser.current = { id: u.id, name: u.name, email: u.email, role: 'member' }
    // The id is an RPC argument too (final review): a forged non-string used to reach
    // Prisma and throw a PrismaClientValidationError — a 500 — instead of the
    // { ok:false, message } contract. Both actions reject it before the service runs.
    expect(await editProjectUpdateAction('', { body: 'x', health: 'ON_TRACK' })).toEqual({ ok: false, message: 'Update not found.' })
    expect(await editProjectUpdateAction(42 as never, { body: 'x', health: 'ON_TRACK' })).toEqual({ ok: false, message: 'Update not found.' })
    expect(await deleteProjectUpdateAction(null as never)).toEqual({ ok: false, message: 'Update not found.' })
    expect(await deleteProjectUpdateAction({ id: up.id } as never)).toEqual({ ok: false, message: 'Update not found.' })
    expect((await prisma.projectUpdate.findUniqueOrThrow({ where: { id: up.id } })).body).toBe('first')
    expect(await editProjectUpdateAction(up.id, { body: '', health: 'ON_TRACK' }))
      .toEqual({ ok: false, message: 'An update needs a few words.' })
    expect(await editProjectUpdateAction(up.id, { body: 'x', health: 'SIDEWAYS' as never })).toMatchObject({ ok: false })
    expect((await editProjectUpdateAction(up.id, { body: 'second', health: 'AT_RISK' })).ok).toBe(true)
    expect(await prisma.projectUpdate.findUniqueOrThrow({ where: { id: up.id } }))
      .toMatchObject({ body: 'second', health: 'AT_RISK' })

    // A PolicyError comes back as { ok:false, message }, never as a throw.
    mockUser.current = { id: other.id, name: other.name, email: other.email, role: 'member' }
    expect(await deleteProjectUpdateAction(up.id)).toMatchObject({ ok: false })
    mockUser.current = { id: u.id, name: u.name, email: u.email, role: 'member' }
    expect((await deleteProjectUpdateAction(up.id)).ok).toBe(true)
    expect((await prisma.projectUpdate.findUniqueOrThrow({ where: { id: up.id } })).deletedAt).not.toBeNull()
  })
})
