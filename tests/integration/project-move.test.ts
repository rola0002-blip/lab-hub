import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeProject, seedSystem } from '../factories'
import { moveProject, listProjects } from '@/features/issues/project-service'
import { PolicyError } from '@/features/issues/issue-policy'
import { REBALANCE_THRESHOLD } from '@/features/issues/rank'

// v0.12 §6.1: the client sends only the ids the project sits BETWEEN after the
// move; the server mints the key. The moveIssue shape minus status/activity/SSE.
describe('moveProject (v0.12 §6.1)', () => {
  beforeEach(resetDb)

  const order = async () => (await listProjects()).map((p) => p.id)
  // Three projects, one keyspace apart, in a self-evident arrangement order.
  async function seedThree() {
    const a = await makeProject({ name: 'A', rank: 'B' })
    const b = await makeProject({ name: 'B', rank: 'K' })
    const c = await makeProject({ name: 'C', rank: 'V' })
    return { a, b, c }
  }

  it('moves a project to the front of the arrangement', async () => {
    const me = await makeUser({ role: 'member' })
    const { a, b, c } = await seedThree()
    expect(await order()).toEqual([a.id, b.id, c.id])
    const moved = await moveProject({ actorId: me.id, role: 'member', projectId: c.id, prevId: null, nextId: a.id })
    expect(await order()).toEqual([c.id, a.id, b.id])
    // The return is the full DTO carrying the freshly minted key, not the stale one.
    expect(moved.id).toBe(c.id)
    expect(moved.rank).toBe((await prisma.project.findUniqueOrThrow({ where: { id: c.id } })).rank)
    expect(moved.rank).not.toBe(c.rank)
  })

  it('moves a project between two neighbours', async () => {
    const me = await makeUser({ role: 'member' })
    const { a, b, c } = await seedThree()
    await moveProject({ actorId: me.id, role: 'member', projectId: a.id, prevId: b.id, nextId: c.id })
    expect(await order()).toEqual([b.id, a.id, c.id])
  })

  it('moves a project to the end of the arrangement', async () => {
    const me = await makeUser({ role: 'member' })
    const { a, b, c } = await seedThree()
    await moveProject({ actorId: me.id, role: 'member', projectId: a.id, prevId: c.id, nextId: null })
    expect(await order()).toEqual([b.id, c.id, a.id])
  })

  it('rejects a guest with forbidden and an unknown project with not_found', async () => {
    const guest = await makeUser({ role: 'guest' })
    const me = await makeUser({ role: 'member' })
    const { a, b } = await seedThree()
    await expect(moveProject({ actorId: guest.id, role: 'guest', projectId: a.id, prevId: b.id, nextId: null }))
      .rejects.toMatchObject({ name: 'PolicyError', code: 'forbidden' })
    await expect(moveProject({ actorId: me.id, role: 'member', projectId: 'nope', prevId: null, nextId: a.id }))
      .rejects.toBeInstanceOf(PolicyError)
    await expect(moveProject({ actorId: me.id, role: 'member', projectId: 'nope', prevId: null, nextId: a.id }))
      .rejects.toMatchObject({ code: 'not_found' })
  })

  // Stale client: the neighbours it names are out of order (prev's key > next's),
  // so rankBetween throws and the move falls through to a whole-table reseat.
  // "Between the two" does not exist for inverted bounds — prevId wins.
  it('self-heals inverted neighbour bounds, landing the project immediately after prevId', async () => {
    const me = await makeUser({ role: 'member' })
    const { a, b, c } = await seedThree() // ranks B < K < V
    await expect(moveProject({ actorId: me.id, role: 'member', projectId: b.id, prevId: c.id, nextId: a.id }))
      .resolves.toBeTruthy()
    expect(await order()).toEqual([a.id, c.id, b.id]) // spliced after prevId (C)
    const ranks = (await prisma.project.findMany({ select: { rank: true } })).map((p) => p.rank)
    expect(new Set(ranks).size).toBe(3) // all distinct after the reseat
    for (const r of ranks) {
      expect(r).toMatch(/^[0-9A-Za-z]+$/)
      expect(r.endsWith('0')).toBe(false) // rank.ts invariant: lexicographic order = fraction order
    }
  })

  // Pathologically dense neighbours: splitting them yields a key longer than
  // REBALANCE_THRESHOLD, so the length guard reseats the whole table instead.
  it('self-heals exhausted precision by reseating every key short', async () => {
    const me = await makeUser({ role: 'member' })
    const a = await makeProject({ name: 'A', rank: 'V' })
    const b = await makeProject({ name: 'B', rank: `V${'0'.repeat(47)}1` })
    const c = await makeProject({ name: 'C' })
    await moveProject({ actorId: me.id, role: 'member', projectId: c.id, prevId: a.id, nextId: b.id })
    expect(await order()).toEqual([a.id, c.id, b.id]) // the requested order holds
    const ranks = (await prisma.project.findMany({ select: { rank: true } })).map((p) => p.rank)
    expect(Math.max(...ranks.map((r) => r.length))).toBeLessThan(REBALANCE_THRESHOLD)
    expect(new Set(ranks).size).toBe(3)
  })

  // §2 non-goal: rearranging the shelf is not lab news — no announce, and (no SSE
  // event this wave) nothing else observes the move but the next read.
  it('is silent — a move announces nothing to #lab-updates', async () => {
    await seedSystem()
    const me = await makeUser({ role: 'member' })
    const { a, b } = await seedThree()
    await moveProject({ actorId: me.id, role: 'member', projectId: a.id, prevId: b.id, nextId: null })
    expect(await prisma.message.count()).toBe(0)
  })
})
