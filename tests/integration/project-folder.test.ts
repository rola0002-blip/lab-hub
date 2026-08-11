import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser, makeProject, makeDocumentFolder, seedSystem } from '../factories'
import { createProject, updateProject, getProject, listProjects } from '@/features/issues/project-service'
import { deleteFolder } from '@/features/documents/document-service'
import { PolicyError } from '@/features/issues/issue-policy'

// v0.15 §5.1–5.2: a project may point at ONE shared Files folder. The link is a
// nullable FK with no @unique (a "Protocols" folder may back several projects) and
// ON DELETE SET NULL, so deleting the folder detaches every project silently.
describe('project ↔ document folder link (v0.15 §5.2)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('links a folder and every read path reports the same { id, name }', async () => {
    const me = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ name: 'Protocols', createdById: me.id })
    const p = await makeProject()
    const updated = await updateProject({ actorId: me.id, role: 'member', id: p.id, documentFolderId: folder.id })
    expect(updated.documentFolder).toEqual({ id: folder.id, name: 'Protocols' })
    expect((await getProject(p.id))!.documentFolder).toEqual({ id: folder.id, name: 'Protocols' })
    const listed = (await listProjects()).find((x) => x.id === p.id)!
    expect(listed.documentFolder).toEqual({ id: folder.id, name: 'Protocols' })
  })

  // No @unique on the column: one shared folder may back several projects.
  it('lets two projects share one folder', async () => {
    const me = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ name: 'Shared', createdById: me.id })
    const a = await makeProject()
    const b = await makeProject()
    await updateProject({ actorId: me.id, role: 'member', id: a.id, documentFolderId: folder.id })
    await updateProject({ actorId: me.id, role: 'member', id: b.id, documentFolderId: folder.id })
    expect((await getProject(a.id))!.documentFolder?.id).toBe(folder.id)
    expect((await getProject(b.id))!.documentFolder?.id).toBe(folder.id)
  })

  // The `!== undefined` spread idiom: explicit null unlinks, an omitted key leaves
  // the existing link alone (an unrelated edit must not silently detach a folder).
  it('unlinks on explicit null and leaves the link untouched when the key is omitted', async () => {
    const me = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ createdById: me.id })
    const p = await makeProject()
    await updateProject({ actorId: me.id, role: 'member', id: p.id, documentFolderId: folder.id })
    const renamed = await updateProject({ actorId: me.id, role: 'member', id: p.id, name: 'Renamed' })
    expect(renamed.documentFolder?.id).toBe(folder.id)
    const unlinked = await updateProject({ actorId: me.id, role: 'member', id: p.id, documentFolderId: null })
    expect(unlinked.documentFolder).toBeNull()
    expect((await getProject(p.id))!.documentFolder).toBeNull()
  })

  it('rejects an unknown folder id with PolicyError invalid, writing nothing', async () => {
    const me = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ createdById: me.id })
    const p = await makeProject()
    await updateProject({ actorId: me.id, role: 'member', id: p.id, documentFolderId: folder.id })
    await expect(updateProject({ actorId: me.id, role: 'member', id: p.id, documentFolderId: 'nope' }))
      .rejects.toBeInstanceOf(PolicyError)
    await expect(updateProject({ actorId: me.id, role: 'member', id: p.id, documentFolderId: 'nope' }))
      .rejects.toMatchObject({ code: 'invalid' })
    // The failed write left the existing link intact.
    expect((await getProject(p.id))!.documentFolder?.id).toBe(folder.id)
    await expect(createProject({ actorId: me.id, role: 'member', name: 'Nope', documentFolderId: 'nope' }))
      .rejects.toMatchObject({ name: 'PolicyError', code: 'invalid' })
  })

  // assertCanMutate stays the single project-mutation predicate — no new gate for
  // the link, so a guest is refused before the folder is even resolved.
  it('rejects a guest with forbidden', async () => {
    const guest = await makeUser({ role: 'guest' })
    const folder = await makeDocumentFolder()
    const p = await makeProject()
    await expect(updateProject({ actorId: guest.id, role: 'guest', id: p.id, documentFolderId: folder.id }))
      .rejects.toMatchObject({ name: 'PolicyError', code: 'forbidden' })
    expect((await getProject(p.id))!.documentFolder).toBeNull()
  })

  // ON DELETE SET NULL: the Files service only deletes EMPTY folders, and doing so
  // detaches the project rather than erroring or orphaning the FK.
  it('detaches the project when the linked (empty) folder is deleted', async () => {
    const me = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ createdById: me.id })
    const p = await makeProject()
    await updateProject({ actorId: me.id, role: 'member', id: p.id, documentFolderId: folder.id })
    await deleteFolder({ userId: me.id, role: 'member', id: folder.id })
    expect((await getProject(p.id))!.documentFolder).toBeNull()
  })

  it('createProject stores the folder and fills the DTO field', async () => {
    const me = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ name: 'Datasets', createdById: me.id })
    const created = await createProject({ actorId: me.id, role: 'member', name: 'Wave', documentFolderId: folder.id })
    expect(created.documentFolder).toEqual({ id: folder.id, name: 'Datasets' })
    expect((await getProject(created.id))!.documentFolder).toEqual({ id: folder.id, name: 'Datasets' })
    // A project created without one reads null, never undefined — the field is
    // REQUIRED on the DTO, filled by every producer.
    const plain = await createProject({ actorId: me.id, role: 'member', name: 'Plain' })
    expect(plain.documentFolder).toBeNull()
  })
})
