import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser } from '../factories'
import { prisma } from '@/lib/db'
import { pinProject, unpinProject, listPinnedProjects, createProject, MAX_PINS } from '@/features/issues/project-service'
import { createIssue } from '@/features/issues/issue-service'
import { PolicyError } from '@/features/issues/issue-policy'

// makeUser returns the raw Prisma row (role: string), so the service calls pass
// the Role union as literals — the milestones.test.ts convention.
describe('pinned projects', () => {
  beforeEach(resetDb)

  it('pins in order, is idempotent, counts open issues, unpins, drops deleted', async () => {
    const u = await makeUser({ role: 'member' })
    const a = await createProject({ actorId: u.id, role: 'member', name: 'A' })
    const b = await createProject({ actorId: u.id, role: 'member', name: 'B' })
    // Pinned B-first so pin order (['B','A']) is distinguishable from name order
    await pinProject({ userId: u.id, projectId: b.id })
    await pinProject({ userId: u.id, projectId: a.id })
    await pinProject({ userId: u.id, projectId: a.id }) // idempotent repeat
    expect((await listPinnedProjects(u.id)).map((p) => p.name)).toEqual(['B', 'A'])
    // openCount: one OPEN in A, one DONE in A (not counted)
    await createIssue({ actorId: u.id, role: 'member', title: 't1', projectId: a.id })
    await createIssue({ actorId: u.id, role: 'member', title: 't2', projectId: a.id, status: 'DONE' })
    expect((await listPinnedProjects(u.id)).find((p) => p.id === a.id)?.openCount).toBe(1)
    await unpinProject({ userId: u.id, projectId: a.id })
    expect((await listPinnedProjects(u.id)).map((p) => p.id)).toEqual([b.id])
    // A deleted project drops out of the list silently
    await prisma.project.delete({ where: { id: b.id } })
    expect(await listPinnedProjects(u.id)).toEqual([])
  })

  it('refuses the 9th pin with a PolicyError and unknown projects with not_found', async () => {
    const u = await makeUser({ role: 'member' })
    const ids: string[] = []
    for (let i = 0; i < MAX_PINS; i++) {
      const p = await createProject({ actorId: u.id, role: 'member', name: `P${i}` })
      ids.push(p.id)
      await pinProject({ userId: u.id, projectId: p.id })
    }
    const extra = await createProject({ actorId: u.id, role: 'member', name: 'X' })
    await expect(pinProject({ userId: u.id, projectId: extra.id })).rejects.toBeInstanceOf(PolicyError)
    await expect(pinProject({ userId: u.id, projectId: extra.id })).rejects.toMatchObject({ code: 'invalid' })
    await expect(pinProject({ userId: u.id, projectId: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
    // Unpinning an unknown project is a silent no-op, not an error
    await unpinProject({ userId: u.id, projectId: 'nope' })
    expect((await listPinnedProjects(u.id)).length).toBe(MAX_PINS)
    // Re-pinning one of the already-pinned 8 is idempotent: no throw, no cap hit,
    // and the count stays 8 (no duplicate id slipped in).
    await pinProject({ userId: u.id, projectId: ids[0] })
    expect((await listPinnedProjects(u.id)).length).toBe(MAX_PINS)
  })

  it('lets guests pin and unpin (per-user state, no role gate)', async () => {
    const m = await makeUser({ role: 'member' })
    const g = await makeUser({ role: 'guest' })
    const p = await createProject({ actorId: m.id, role: 'member', name: 'P' })
    await pinProject({ userId: g.id, projectId: p.id })
    expect((await listPinnedProjects(g.id)).map((x) => x.id)).toEqual([p.id])
    // One user's pins never leak into another's list
    expect(await listPinnedProjects(m.id)).toEqual([])
    await unpinProject({ userId: g.id, projectId: p.id })
    expect(await listPinnedProjects(g.id)).toEqual([])
  })
})
