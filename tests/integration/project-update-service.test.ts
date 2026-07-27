import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeProject, makeChannel, makeMember, makeMessage, seedSystem } from '../factories'
import { postProjectUpdate, listProjectUpdates, pauseUpdatePrompts, resumeUpdatePrompts } from '@/features/issues/project-update-service'
import { nthPromptAfter } from '@/features/issues/update-prompt'
import { LAB_UPDATES_CHANNEL_ID } from '@/features/bot'

describe('project-update-service (SP8 §4.6)', () => {
  beforeEach(async () => { await resetDb(); await seedSystem() })

  it('posts an update and announces once to #lab-updates with health label + 200-char excerpt, no @-mention', async () => {
    const u = await makeUser({ name: 'Priya' })
    const p = await makeProject({ name: 'Graphene-on-Ge' })
    const long = 'x'.repeat(500)
    const dto = await postProjectUpdate({ projectId: p.id, actorId: u.id, role: 'member', health: 'AT_RISK', body: `<!channel> ${long}` })
    expect(dto.health).toBe('AT_RISK')
    expect(dto.author.name).toBe('Priya')
    const announce = await prisma.message.findFirstOrThrow({ where: { conversationId: LAB_UPDATES_CHANNEL_ID } })
    expect(announce.body).toContain('Priya posted an update on Graphene-on-Ge')
    expect(announce.body).toContain('At risk')
    expect(announce.body).toContain(`/projects/${p.id}`)
    expect(announce.mentionsChannel).toBe(false) // neutralized
    expect(announce.body.length).toBeLessThan(400) // 200-char excerpt, not the whole body
  })
  it('caps the body at 4000 and rejects whitespace-only', async () => {
    const u = await makeUser(); const p = await makeProject()
    const dto = await postProjectUpdate({ projectId: p.id, actorId: u.id, role: 'member', health: 'ON_TRACK', body: 'y'.repeat(5000) })
    expect(dto.body.length).toBe(4000)
    await expect(postProjectUpdate({ projectId: p.id, actorId: u.id, role: 'member', health: 'ON_TRACK', body: '   ' }))
      .rejects.toMatchObject({ code: 'invalid' })
  })
  it('forged originMessageId: missing message and non-member both raise the SAME not_found', async () => {
    const u = await makeUser(); const p = await makeProject()
    const priv = await makeChannel({ isPrivate: true })
    const insider = await makeUser(); await makeMember(priv.id, insider.id)
    const secret = await makeMessage(priv.id, insider.id)
    for (const id of ['nope', secret.id]) {
      await expect(postProjectUpdate({ projectId: p.id, actorId: u.id, role: 'member', health: 'ON_TRACK', body: 'b', originMessageId: id }))
        .rejects.toMatchObject({ code: 'not_found' })
    }
  })
  it('guests are 403 on post, pause and resume', async () => {
    const g = await makeUser({ role: 'guest' }); const p = await makeProject()
    for (const call of [
      () => postProjectUpdate({ projectId: p.id, actorId: g.id, role: 'guest', health: 'ON_TRACK', body: 'b' }),
      () => pauseUpdatePrompts({ projectId: p.id, actorId: g.id, role: 'guest', weeks: 1 }),
      () => resumeUpdatePrompts({ projectId: p.id, actorId: g.id, role: 'guest' }),
    ]) await expect(call()).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('pause anchors to the nth prompt instant + 1ms; resume clears', async () => {
    const u = await makeUser(); const p = await makeProject()
    await prisma.organization.create({ data: { name: 'Lab', timezone: 'Asia/Singapore' } }) // day=2 hour=16 defaults
    const before = new Date()
    await pauseUpdatePrompts({ projectId: p.id, actorId: u.id, role: 'member', weeks: 1 })
    const after = new Date()
    const stored = (await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).updatePromptsPausedUntil!
    const lo = +nthPromptAfter(before, 1, 'Asia/Singapore', 2, 16) + 1
    const hi = +nthPromptAfter(after, 1, 'Asia/Singapore', 2, 16) + 1
    expect(+stored === lo || +stored === hi).toBe(true) // now moved between the two reads at most
    await resumeUpdatePrompts({ projectId: p.id, actorId: u.id, role: 'member' })
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).updatePromptsPausedUntil).toBeNull()
  })
  it('listProjectUpdates returns reverse-chron DTOs with ISO dates', async () => {
    const u = await makeUser(); const p = await makeProject()
    await postProjectUpdate({ projectId: p.id, actorId: u.id, role: 'member', health: 'ON_TRACK', body: 'first' })
    await postProjectUpdate({ projectId: p.id, actorId: u.id, role: 'member', health: 'OFF_TRACK', body: 'second' })
    const list = await listProjectUpdates(p.id)
    expect(list.map((x) => x.body)).toEqual(['second', 'first'])
    expect(typeof list[0].createdAt).toBe('string')
  })
})
