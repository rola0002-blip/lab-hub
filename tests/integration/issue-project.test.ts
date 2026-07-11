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
})
