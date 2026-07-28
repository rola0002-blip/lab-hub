import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeProject, makeChannel, makeMember, makeMessage, seedSystem } from '../factories'
import { postProjectUpdate, listProjectUpdates, pauseUpdatePrompts, resumeUpdatePrompts } from '@/features/issues/project-update-service'
import { nthPromptAfter } from '@/features/issues/update-prompt'
import { LAB_UPDATES_CHANNEL_ID } from '@/features/bot'

// Action-level seams (the org-settings.test.ts pair): a Server Action invoked
// directly under Vitest has no request scope, so both the session read and the
// cache revalidation are stubbed. The service tests above are unaffected —
// project-update-service imports `Role` as a type only.
const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: 'admin' | 'member' | 'guest' } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => { if (!mockUser.current) throw new Error('NEXT_REDIRECT'); return mockUser.current },
  requireAdmin: async () => { if (mockUser.current?.role !== 'admin') throw new Error('NEXT_REDIRECT'); return mockUser.current },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { pauseUpdatePromptsAction } from '@/app/(app)/issues/actions'

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
  it('pauseUpdatePromptsAction runtime-validates weeks: a forged value returns ok:false and writes nothing', async () => {
    const u = await makeUser(); const p = await makeProject()
    mockUser.current = { id: u.id, name: u.name, email: u.email, role: 'member' }
    // `weeks: 1 | 4` is erased at runtime and a Server Action is an RPC endpoint.
    // 0 would reach nthPromptAfter's `unreachable` throw (a 500); 1e9 would hand it a
    // 7e9-iteration synchronous TZDate loop — an event-loop stall, not just a 500.
    for (const weeks of [0, 1e9, -1, 2, 1.5, NaN, '4' as unknown as number]) {
      await expect(pauseUpdatePromptsAction(p.id, weeks as never)).resolves.toEqual({ ok: false, message: 'Invalid pause length.' })
    }
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).updatePromptsPausedUntil).toBeNull()
    // …and the two legitimate values still go through.
    expect((await pauseUpdatePromptsAction(p.id, 4)).ok).toBe(true)
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).updatePromptsPausedUntil).not.toBeNull()
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
