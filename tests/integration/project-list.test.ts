import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeProject, makeIssue, makeProjectUpdate, seedSystem } from '../factories'
import { listProjects, getProject, listProjectOptions, createProject, updateProject } from '@/features/issues/project-service'
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
  it('listProjectOptions returns { id, name } newest-first', async () => {
    await makeProject({ name: 'Old', createdAt: new Date(Date.now() - 60_000) })
    await makeProject({ name: 'New' })
    expect(await listProjectOptions()).toEqual([expect.objectContaining({ name: 'New' }), expect.objectContaining({ name: 'Old' })])
  })
})
