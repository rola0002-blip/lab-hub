import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser, makeIssue, makeProject, seedSystem } from '../factories'
import { createIssue, setAssignee, setProject } from '@/features/issues/issue-service'
import { createProject, updateProject } from '@/features/issues/project-service'
import { PolicyError } from '@/features/issues/issue-policy'
import { COLOSSUS_BOT_ID } from '@/features/bot'

const invalid = (p: Promise<unknown>) =>
  p.then(() => { throw new Error('should have thrown') },
    (e) => { expect(e).toBeInstanceOf(PolicyError); expect((e as PolicyError).code).toBe('invalid') })

describe('FK validation (SP8 §3.2)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('createIssue rejects unknown / banned / system assignee and unknown project with typed invalid', async () => {
    const u = await makeUser()
    const banned = await makeUser({ banned: true })
    await invalid(createIssue({ actorId: u.id, role: 'member', title: 't', assigneeId: 'nope' }))
    await invalid(createIssue({ actorId: u.id, role: 'member', title: 't', assigneeId: banned.id }))
    await invalid(createIssue({ actorId: u.id, role: 'member', title: 't', assigneeId: COLOSSUS_BOT_ID }))
    await invalid(createIssue({ actorId: u.id, role: 'member', title: 't', projectId: 'nope' }))
  })
  it('a GUEST assignee is still accepted (pickers offer guests — §3.2)', async () => {
    const u = await makeUser()
    const guest = await makeUser({ role: 'guest' })
    const dto = await createIssue({ actorId: u.id, role: 'member', title: 't', assigneeId: guest.id })
    expect(dto.assignee?.id).toBe(guest.id)
  })
  it('setAssignee / setProject validate non-null ids; null (clear) passes', async () => {
    const u = await makeUser()
    const i = await makeIssue(u.id)
    await invalid(setAssignee({ actorId: u.id, role: 'member', issueId: i.id, assigneeId: 'nope' }))
    await invalid(setProject({ actorId: u.id, role: 'member', issueId: i.id, projectId: 'nope' }))
    await setAssignee({ actorId: u.id, role: 'member', issueId: i.id, assigneeId: null })
    await setProject({ actorId: u.id, role: 'member', issueId: i.id, projectId: null })
  })
  // The empty string is falsy but is NOT "no id": `assigneeId ?? null` keeps '' and
  // updateProject's spread is keyed on `!== undefined`, so a truthiness guard would
  // let '' through to the FK → P2003 → 500. Every §3.2 guard tests `!= null`.
  it('an empty-string id is rejected by every guard, not skipped', async () => {
    const u = await makeUser()
    const i = await makeIssue(u.id)
    const q = await makeProject()
    await invalid(createIssue({ actorId: u.id, role: 'member', title: 't', assigneeId: '' }))
    await invalid(createIssue({ actorId: u.id, role: 'member', title: 't', projectId: '' }))
    await invalid(setAssignee({ actorId: u.id, role: 'member', issueId: i.id, assigneeId: '' }))
    await invalid(setProject({ actorId: u.id, role: 'member', issueId: i.id, projectId: '' }))
    await invalid(createProject({ actorId: u.id, role: 'member', name: 'P', leadId: '' }))
    await invalid(updateProject({ actorId: u.id, role: 'member', id: q.id, leadId: '' }))
  })
  it('createProject / updateProject validate leadId; a guest lead stays legal', async () => {
    const u = await makeUser()
    const guest = await makeUser({ role: 'guest' })
    await invalid(createProject({ actorId: u.id, role: 'member', name: 'P', leadId: 'nope' }))
    const p = await createProject({ actorId: u.id, role: 'member', name: 'P', leadId: guest.id })
    expect(p.lead?.id).toBe(guest.id)
    const q = await makeProject()
    await invalid(updateProject({ actorId: u.id, role: 'member', id: q.id, leadId: 'nope' }))
    await updateProject({ actorId: u.id, role: 'member', id: q.id, leadId: null }) // clearing passes
  })
})
