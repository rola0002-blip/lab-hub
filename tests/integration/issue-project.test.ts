import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeIssue } from '../factories'
import { createProject, listProjects, getProject, deleteProject, updateProject } from '@/features/issues/project-service'
import { PolicyError } from '@/features/issues/issue-policy'

describe('project-service', () => {
  beforeEach(resetDb)

  it('creates, computes progress from issues, and blocks guests', async () => {
    const admin = await makeUser({ role: 'admin' })
    const p = await createProject({ actorId: admin.id, role: 'admin', name: 'Paper 1', leadId: admin.id })
    await makeIssue(admin.id, { projectId: p.id, status: 'DONE', rank: 'V' })
    await makeIssue(admin.id, { projectId: p.id, status: 'TODO', rank: 'k' })
    const [dto] = await listProjects()
    expect(dto.progress).toEqual({ done: 1, total: 2, percent: 50 })
    expect(dto.lead?.id).toBe(admin.id)
    await expect(createProject({ actorId: admin.id, role: 'guest', name: 'x' })).rejects.toBeInstanceOf(PolicyError)
  })

  it('admin-only delete cascades issues to projectId=null, never deletes them', async () => {
    const admin = await makeUser({ role: 'admin' })
    const member = await makeUser({ role: 'member' })
    const p = await createProject({ actorId: admin.id, role: 'admin', name: 'Ops' })
    const iss = await makeIssue(member.id, { projectId: p.id, rank: 'V' })
    await expect(deleteProject({ role: 'member', id: p.id })).rejects.toMatchObject({ code: 'forbidden' })
    await deleteProject({ role: 'admin', id: p.id })
    expect(await prisma.project.findUnique({ where: { id: p.id } })).toBeNull()
    const still = await prisma.issue.findUnique({ where: { id: iss.id } })
    expect(still?.projectId).toBeNull()
  })

  it('updates fields and 404s a missing project', async () => {
    const admin = await makeUser({ role: 'admin' })
    const p = await createProject({ actorId: admin.id, role: 'admin', name: 'A' })
    const u = await updateProject({ actorId: admin.id, role: 'admin', id: p.id, status: 'COMPLETED' })
    expect(u.status).toBe('COMPLETED')
    await expect(updateProject({ actorId: admin.id, role: 'admin', id: 'nope', name: 'x' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('excludes CANCELED issues from the progress denominator (Linear semantics)', async () => {
    const admin = await makeUser({ role: 'admin' })
    const p = await createProject({ actorId: admin.id, role: 'admin', name: 'Cancel-aware' })
    await makeIssue(admin.id, { projectId: p.id, status: 'DONE', rank: 'V' })
    await makeIssue(admin.id, { projectId: p.id, status: 'CANCELED', rank: 'k' })
    // {DONE, CANCELED} → canceled drops out of the denominator → 100%
    const [afterCancel] = await listProjects()
    expect(afterCancel.progress).toEqual({ done: 1, total: 1, percent: 100 })
    await makeIssue(admin.id, { projectId: p.id, status: 'TODO', rank: 'z' })
    // {DONE, TODO, CANCELED} → 1 of 2 counted issues done → 50%, on both paths
    const [afterTodo] = await listProjects()
    expect(afterTodo.progress).toEqual({ done: 1, total: 2, percent: 50 })
    expect((await getProject(p.id))?.progress).toEqual({ done: 1, total: 2, percent: 50 })
  })

  it('getProject returns a dto with computed progress, null for a missing id', async () => {
    const admin = await makeUser({ role: 'admin' })
    const p = await createProject({ actorId: admin.id, role: 'admin', name: 'Fetch', leadId: admin.id })
    await makeIssue(admin.id, { projectId: p.id, status: 'DONE', rank: 'V' })
    await makeIssue(admin.id, { projectId: p.id, status: 'DONE', rank: 'k' })
    await makeIssue(admin.id, { projectId: p.id, status: 'TODO', rank: 'z' })
    const dto = await getProject(p.id)
    expect(dto?.id).toBe(p.id)
    expect(dto?.lead?.id).toBe(admin.id)
    expect(dto?.progress).toEqual({ done: 2, total: 3, percent: 67 })
    expect(await getProject('nope')).toBeNull()
  })

  it('rejects a blank name with a 400 invalid on create and update', async () => {
    const admin = await makeUser({ role: 'admin' })
    await expect(createProject({ actorId: admin.id, role: 'admin', name: '   ' })).rejects.toMatchObject({ code: 'invalid' })
    const p = await createProject({ actorId: admin.id, role: 'admin', name: 'Valid' })
    await expect(updateProject({ actorId: admin.id, role: 'admin', id: p.id, name: '' })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('404s when deleting a missing project as admin', async () => {
    await expect(deleteProject({ role: 'admin', id: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('persists startDate and exposes it (ISO) on the DTO', async () => {
    const admin = await makeUser({ role: 'admin' })
    const start = new Date('2026-09-01T00:00:00Z')
    const target = new Date('2026-09-30T00:00:00Z')
    const p = await createProject({ actorId: admin.id, role: 'admin', name: 'Dated', startDate: start, targetDate: target })
    expect(p.startDate).toBe(start.toISOString())
    expect(p.targetDate).toBe(target.toISOString())
    // survives a fresh read
    expect((await getProject(p.id))?.startDate).toBe(start.toISOString())
    const [listed] = await listProjects()
    expect(listed.startDate).toBe(start.toISOString())
  })

  it('allows startDate == targetDate and either date alone', async () => {
    const admin = await makeUser({ role: 'admin' })
    const same = new Date('2026-09-10T00:00:00Z')
    const eq = await createProject({ actorId: admin.id, role: 'admin', name: 'Same-day', startDate: same, targetDate: same })
    expect(eq.startDate).toBe(same.toISOString())
    const startOnly = await createProject({ actorId: admin.id, role: 'admin', name: 'Start only', startDate: same })
    expect(startOnly.startDate).toBe(same.toISOString())
    expect(startOnly.targetDate).toBeNull()
    const targetOnly = await createProject({ actorId: admin.id, role: 'admin', name: 'Target only', targetDate: same })
    expect(targetOnly.startDate).toBeNull()
    expect(targetOnly.targetDate).toBe(same.toISOString())
  })

  it('rejects startDate after targetDate on create with a 400 invalid', async () => {
    const admin = await makeUser({ role: 'admin' })
    await expect(createProject({
      actorId: admin.id, role: 'admin', name: 'Inverted',
      startDate: new Date('2026-10-01T00:00:00Z'), targetDate: new Date('2026-09-01T00:00:00Z'),
    })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('validates the merged pair on update (a single-date edit cannot invert the range)', async () => {
    const admin = await makeUser({ role: 'admin' })
    const p = await createProject({
      actorId: admin.id, role: 'admin', name: 'Ranged',
      startDate: new Date('2026-09-01T00:00:00Z'), targetDate: new Date('2026-09-30T00:00:00Z'),
    })
    // Moving only the start date past the existing target is rejected…
    await expect(updateProject({ actorId: admin.id, role: 'admin', id: p.id, startDate: new Date('2026-10-15T00:00:00Z') }))
      .rejects.toMatchObject({ code: 'invalid' })
    // …and moving only the target before the existing start is rejected…
    await expect(updateProject({ actorId: admin.id, role: 'admin', id: p.id, targetDate: new Date('2026-08-01T00:00:00Z') }))
      .rejects.toMatchObject({ code: 'invalid' })
    // …while a valid shift of both persists.
    const moved = await updateProject({
      actorId: admin.id, role: 'admin', id: p.id,
      startDate: new Date('2026-11-01T00:00:00Z'), targetDate: new Date('2026-11-20T00:00:00Z'),
    })
    expect(moved.startDate).toBe(new Date('2026-11-01T00:00:00Z').toISOString())
    // Clearing the start date leaves a lone target, which is always valid.
    const cleared = await updateProject({ actorId: admin.id, role: 'admin', id: p.id, startDate: null })
    expect(cleared.startDate).toBeNull()
    expect(cleared.targetDate).toBe(new Date('2026-11-20T00:00:00Z').toISOString())
  })
})
