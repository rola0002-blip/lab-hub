import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser } from '../factories'
import { prisma } from '@/lib/db'
import { createMilestone, listMilestones, toggleMilestone, updateMilestone, deleteMilestone, createProject, getProject } from '@/features/issues/project-service'
import { PolicyError } from '@/features/issues/issue-policy'

// makeUser returns the raw Prisma row (role: string), so the service calls pass
// the Role union as literals — the project-move.test.ts convention.
describe('milestones', () => {
  beforeEach(resetDb)

  it('CRUDs milestones gated by assertCanMutate', async () => {
    const u = await makeUser({ role: 'admin' })
    const p = await createProject({ actorId: u.id, role: 'admin', name: 'P' })
    const m = await createMilestone({ actorId: u.id, role: 'admin', projectId: p.id, name: 'Design freeze', date: '2026-09-01' })
    expect((await listMilestones(p.id)).map((x) => x.id)).toEqual([m.id])
    await toggleMilestone({ actorId: u.id, role: 'admin', milestoneId: m.id })
    expect((await listMilestones(p.id))[0].completedAt).not.toBeNull()
    await toggleMilestone({ actorId: u.id, role: 'admin', milestoneId: m.id }) // undo — toggle clears completedAt
    expect((await listMilestones(p.id))[0].completedAt).toBeNull()
    await updateMilestone({ actorId: u.id, role: 'admin', milestoneId: m.id, name: 'Freeze', date: null })
    expect((await listMilestones(p.id))[0].name).toBe('Freeze')
    await deleteMilestone({ actorId: u.id, role: 'admin', milestoneId: m.id })
    expect(await listMilestones(p.id)).toEqual([])
  })

  it('rejects guests, bad names and bad dates', async () => {
    const u = await makeUser({ role: 'admin' })
    const g = await makeUser({ role: 'guest' })
    const p = await createProject({ actorId: u.id, role: 'admin', name: 'P' })
    await expect(createMilestone({ actorId: g.id, role: 'guest', projectId: p.id, name: 'x', date: null })).rejects.toBeInstanceOf(PolicyError)
    await expect(createMilestone({ actorId: u.id, role: 'admin', projectId: p.id, name: '', date: null })).rejects.toThrow('1–200')
    await expect(createMilestone({ actorId: u.id, role: 'admin', projectId: p.id, name: 'x', date: '09/01/2026' })).rejects.toThrow('valid date')
  })

  it('cascade-deletes with the project and counts into the DTO', async () => {
    const u = await makeUser({ role: 'admin' })
    const p = await createProject({ actorId: u.id, role: 'admin', name: 'P' })
    const m1 = await createMilestone({ actorId: u.id, role: 'admin', projectId: p.id, name: 'M1', date: null })
    await toggleMilestone({ actorId: u.id, role: 'admin', milestoneId: m1.id })
    const dto = await getProject(p.id)
    expect(dto?.milestones).toEqual({ total: 1, complete: 1 })
    await prisma.project.delete({ where: { id: p.id } })
    expect(await prisma.milestone.count()).toBe(0)
    expect(await getProject(p.id)).toBeNull()
  })
})
