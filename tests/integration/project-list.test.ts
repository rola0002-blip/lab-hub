import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeProject, makeIssue, makeProjectUpdate, seedSystem } from '../factories'
import { listProjects, getProject, listProjectOptions, createProject, updateProject } from '@/features/issues/project-service'
import { listProjectUpdates } from '@/features/issues/project-update-service'
import { COLOSSUS_BOT_ID } from '@/features/bot'

describe('extended project reads (SP8 §4.7)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('listProjects and getProject agree on the three new fields', async () => {
    const lead = await makeUser({ name: 'Lena' })
    const guest = await makeUser({ role: 'guest' })
    const now = new Date()
    const p1 = await makeProject({ leadId: lead.id })
    const p2 = await makeProject({ leadId: guest.id })  // guest lead → NOT effective
    const p3 = await makeProject()                       // no lead
    await makeIssue(lead.id, { projectId: p1.id, status: 'TODO', dueDate: new Date(+now - 3 * 86_400_000) })
    const up = await makeProjectUpdate(p1.id, lead.id, { health: 'AT_RISK' })
    const list = await listProjects(now)
    const byId = new Map(list.map((p) => [p.id, p]))
    expect(byId.get(p1.id)).toMatchObject({ hasEffectiveLead: true, openOverdue: 1 })
    expect(byId.get(p1.id)!.latestUpdate).toMatchObject({ id: up.id, health: 'AT_RISK', authorName: 'Lena' })
    expect(byId.get(p2.id)).toMatchObject({ hasEffectiveLead: false, openOverdue: 0, latestUpdate: null })
    expect(byId.get(p3.id)!.hasEffectiveLead).toBe(false)
    const single = await getProject(p1.id, now)
    expect(single).toMatchObject({ hasEffectiveLead: true, openOverdue: 1 })
    expect(single!.latestUpdate?.id).toBe(up.id)
    expect(single!.lead).toEqual({ id: lead.id, name: 'Lena', image: null }) // DTO lead shape unchanged
  })
  it('latestUpdate is the NEWEST row and a bot/system lead is not effective', async () => {
    const u = await makeUser()
    const p = await makeProject({ leadId: COLOSSUS_BOT_ID })
    await makeProjectUpdate(p.id, u.id, { createdAt: new Date(Date.now() - 60_000), body: 'old' })
    await makeProjectUpdate(p.id, u.id, { body: 'new' })
    const [dto] = await listProjects()
    expect(dto.hasEffectiveLead).toBe(false)
    expect(dto.latestUpdate?.createdAt).toBeTypeOf('string')
    expect((await prisma.projectUpdate.findUniqueOrThrow({ where: { id: dto.latestUpdate!.id } })).body).toBe('new')
  })
  // createdAt alone is not a total order. Two updates posted in the same millisecond
  // would otherwise let each read site pick a different row as "latest", so the card,
  // the detail header and the feed head could disagree on the same page load.
  it('same-millisecond updates: the feed head, getProject and listProjects name the SAME latest row', async () => {
    const u = await makeUser({ name: 'Ana' })
    const p = await makeProject()
    const at = new Date('2026-07-20T09:00:00.000Z')
    // Inserted lowest-id-first, so a physical-order read would answer 'pu-a'; the id
    // tiebreaker makes 'pu-b' the unambiguous latest everywhere.
    await makeProjectUpdate(p.id, u.id, { id: 'pu-a', createdAt: at, body: 'a', health: 'ON_TRACK' })
    await makeProjectUpdate(p.id, u.id, { id: 'pu-b', createdAt: at, body: 'b', health: 'OFF_TRACK' })
    const feed = await listProjectUpdates(p.id)
    expect(feed.map((x) => x.id)).toEqual(['pu-b', 'pu-a'])
    expect((await getProject(p.id))!.latestUpdate).toMatchObject({ id: 'pu-b', health: 'OFF_TRACK' })
    const card = (await listProjects()).find((x) => x.id === p.id)!
    expect(card.latestUpdate).toMatchObject({ id: 'pu-b', health: 'OFF_TRACK' })
  })
  it('query count does not grow with the number of projects (O(1) queries)', async () => {
    const u = await makeUser()
    const count = async () => {
      const spies = [
        vi.spyOn(prisma.project, 'findMany'), vi.spyOn(prisma.issue, 'groupBy'),
        vi.spyOn(prisma.projectUpdate, 'groupBy'), vi.spyOn(prisma.projectUpdate, 'findMany'),
        vi.spyOn(prisma.organization, 'findFirst'),
      ]
      await listProjects()
      const n = spies.reduce((s, sp) => s + sp.mock.calls.length, 0)
      spies.forEach((s) => s.mockRestore())
      return n
    }
    await makeProject({ leadId: u.id }); await makeProjectUpdate((await makeProject()).id, u.id)
    const small = await count()
    for (let i = 0; i < 6; i++) await makeProjectUpdate((await makeProject()).id, u.id)
    expect(await count()).toBe(small)
  })
  // The write paths return a ProjectDto too, so they owe the same three fields: a
  // fresh project is provably empty, while an update must re-read them.
  it('createProject and updateProject fill the new required fields', async () => {
    const admin = await makeUser({ role: 'admin' })
    const created = await createProject({ actorId: admin.id, role: 'admin', name: 'Wave', leadId: admin.id })
    expect(created).toMatchObject({ hasEffectiveLead: true, openOverdue: 0, latestUpdate: null })
    await makeIssue(admin.id, { projectId: created.id, status: 'TODO', dueDate: new Date(Date.now() - 3 * 86_400_000) })
    const up = await makeProjectUpdate(created.id, admin.id, { health: 'OFF_TRACK' })
    const updated = await updateProject({ actorId: admin.id, role: 'admin', id: created.id, status: 'PAUSED' })
    expect(updated).toMatchObject({ status: 'PAUSED', hasEffectiveLead: true, openOverdue: 1 })
    expect(updated.latestUpdate).toMatchObject({ id: up.id, health: 'OFF_TRACK', authorName: admin.name })
    expect(updated.progress).toEqual({ done: 0, total: 1, percent: 0 })
  })
})

// v0.12 §4.1: one shared manual arrangement, stored as a base-62 fractional index
// (rank.ts) ordered by byte (COLLATE "C"). Lowest key = front of the grid.
describe('project arrangement rank (v0.12 §4.1)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('listProjects and listProjectOptions read in ascending rank order, not creation order', async () => {
    const d = await makeProject({ name: 'D', rank: 'D' })
    const b = await makeProject({ name: 'B', rank: 'B' })
    const c = await makeProject({ name: 'C', rank: 'C' })
    expect((await listProjects()).map((p) => p.id)).toEqual([b.id, c.id, d.id])
    // Same arrangement on the narrow option source, whose { id, name } shape is
    // pinned here too (it feeds the issue pages and both global composers).
    expect(await listProjectOptions()).toEqual([{ id: b.id, name: 'B' }, { id: c.id, name: 'C' }, { id: d.id, name: 'D' }])
  })

  it('the list and the detail read agree on rank (one DTO, one arrangement key)', async () => {
    const p = await makeProject()
    const listed = (await listProjects())[0]
    expect(listed.rank).toBeTypeOf('string')
    expect(listed.rank.length).toBeGreaterThan(0)
    expect((await getProject(p.id))!.rank).toBe(listed.rank)
  })

  it('createProject mints the FRONT rank — a new project lands first in the grid', async () => {
    const member = await makeUser({ role: 'member' })
    const seeded = await makeProject({ rank: 'V' })
    const created = await createProject({ actorId: member.id, role: 'member', name: 'Newest' })
    expect(created.rank < 'V').toBe(true)
    expect((await listProjects()).map((p) => p.id)).toEqual([created.id, seeded.id])
  })

  // The migration's backfill is the only code that ever mints keys for pre-existing
  // rows, and it runs exactly once in production — so it is exercised here by
  // extracting the marked DO block from the migration file and re-running it against
  // rows deliberately re-nulled. NOT NULL is dropped and restored in a finally, so a
  // failing assertion can never leave the column nullable for the rest of the run.
  it('the migration backfill ranks legacy rows newest-first with distinct two-char keys', async () => {
    const sql = readFileSync(path.join(process.cwd(), 'prisma/migrations/20260805000000_project_manual_order/migration.sql'), 'utf8')
    const start = sql.indexOf('-- BACKFILL-START')
    const end = sql.indexOf('-- BACKFILL-END')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const backfill = sql.slice(start + '-- BACKFILL-START'.length, end)
    expect(backfill.trim().length).toBeGreaterThan(0)

    await prisma.$executeRawUnsafe('ALTER TABLE "Project" ALTER COLUMN "rank" DROP NOT NULL')
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Project" ("id","name","description","status","rank","createdAt","updatedAt") VALUES
          ('bf-old','Old','','ACTIVE',NULL,'2026-01-01 00:00:00','2026-01-01 00:00:00'),
          ('bf-mid','Mid','','ACTIVE',NULL,'2026-02-01 00:00:00','2026-02-01 00:00:00'),
          ('bf-new','New','','ACTIVE',NULL,'2026-03-01 00:00:00','2026-03-01 00:00:00')
      `)
      await prisma.$executeRawUnsafe(backfill) // one DO block = one statement
      const rows = await prisma.$queryRawUnsafe<{ id: string; rank: string | null }[]>(
        'SELECT "id","rank" FROM "Project" ORDER BY "createdAt" DESC, "id" ASC',
      )
      expect(rows.map((r) => r.id)).toEqual(['bf-new', 'bf-mid', 'bf-old'])
      expect(rows.every((r) => r.rank !== null)).toBe(true)
      const ranks = rows.map((r) => r.rank!)
      expect(new Set(ranks).size).toBe(ranks.length)
      // Newest first = lowest key, strictly ascending down the createdAt DESC order.
      expect([...ranks].sort()).toEqual(ranks)
      for (const r of ranks) {
        expect(r).toMatch(/^[0-9A-Za-z]{2}$/)
        expect(r.endsWith('0')).toBe(false) // rank.ts invariant: lexicographic order = fraction order
      }
    } finally {
      // Drop anything the backfill failed to rank, so restoring NOT NULL cannot throw
      // over the top of the real failure.
      await prisma.$executeRawUnsafe('DELETE FROM "Project" WHERE "rank" IS NULL')
      await prisma.$executeRawUnsafe('ALTER TABLE "Project" ALTER COLUMN "rank" SET NOT NULL')
    }
  })
})
