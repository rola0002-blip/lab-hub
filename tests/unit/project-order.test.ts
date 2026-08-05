import { describe, it, expect } from 'vitest'
import { moveTargets, projectOrderSignature } from '@/features/issues/project-order'

const IDS = ['a', 'b', 'c', 'd'] as const

describe('moveTargets', () => {
  it('at the first position: front/earlier are no-ops, later/end move down', () => {
    const t = moveTargets(IDS, 0)
    expect(t.front).toBeNull()
    expect(t.earlier).toBeNull()
    expect(t.later).toEqual({ prevId: 'b', nextId: 'c' })
    expect(t.end).toEqual({ prevId: 'd', nextId: null })
  })

  it('one from last: later and end coincide, both non-null', () => {
    const t = moveTargets(IDS, 2)
    expect(t.front).toEqual({ prevId: null, nextId: 'a' })
    expect(t.earlier).toEqual({ prevId: 'a', nextId: 'b' })
    expect(t.later).toEqual({ prevId: 'd', nextId: null })
    expect(t.end).toEqual({ prevId: 'd', nextId: null })
    expect(t.later).toEqual(t.end)
  })

  it('at the last position: later/end are no-ops, front/earlier move up', () => {
    const t = moveTargets(IDS, 3)
    expect(t.later).toBeNull()
    expect(t.end).toBeNull()
    expect(t.front).toEqual({ prevId: null, nextId: 'a' })
    expect(t.earlier).toEqual({ prevId: 'b', nextId: 'c' })
  })

  it('in the middle: front/earlier move up, later/end move down', () => {
    const t = moveTargets(IDS, 1)
    expect(t.front).toEqual({ prevId: null, nextId: 'a' })
    expect(t.earlier).toEqual({ prevId: null, nextId: 'a' })
    expect(t.later).toEqual({ prevId: 'c', nextId: 'd' })
    expect(t.end).toEqual({ prevId: 'd', nextId: null })
  })

  it('a single-element list has no moves at all', () => {
    const t = moveTargets(['only'], 0)
    expect(t).toEqual({ front: null, earlier: null, later: null, end: null })
  })

  it('an out-of-range index has no moves at all', () => {
    for (const index of [-1, 4, 99]) {
      expect(moveTargets(IDS, index)).toEqual({ front: null, earlier: null, later: null, end: null })
    }
    expect(moveTargets([], 0)).toEqual({ front: null, earlier: null, later: null, end: null })
  })

  it('does not mutate the input array', () => {
    const ids = ['a', 'b', 'c']
    moveTargets(ids, 1)
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})

type SigItem = { id: string; rank: string; updatedAt: string; latestUpdate: { createdAt: string } | null }

const items: SigItem[] = [
  { id: 'p1', rank: 'V', updatedAt: '2026-08-01T00:00:00.000Z', latestUpdate: { createdAt: '2026-08-02T00:00:00.000Z' } },
  { id: 'p2', rank: 'k', updatedAt: '2026-08-03T00:00:00.000Z', latestUpdate: null },
  { id: 'p3', rank: 'q', updatedAt: '2026-08-04T00:00:00.000Z', latestUpdate: { createdAt: '2026-08-05T00:00:00.000Z' } },
]

const withPatch = (index: number, patch: Partial<SigItem>): SigItem[] =>
  items.map((it, i) => (i === index ? { ...it, ...patch } : it))

describe('projectOrderSignature', () => {
  it('is insensitive to the input array order', () => {
    expect(projectOrderSignature([...items].reverse())).toBe(projectOrderSignature(items))
    expect(projectOrderSignature([items[1], items[2], items[0]])).toBe(projectOrderSignature(items))
  })

  it('changes when a rank changes', () => {
    expect(projectOrderSignature(withPatch(1, { rank: 'z' }))).not.toBe(projectOrderSignature(items))
  })

  it('changes when an updatedAt changes (card content, not position)', () => {
    expect(projectOrderSignature(withPatch(0, { updatedAt: '2026-08-09T00:00:00.000Z' }))).not.toBe(
      projectOrderSignature(items),
    )
  })

  it('changes when a latestUpdate timestamp changes', () => {
    expect(projectOrderSignature(withPatch(0, { latestUpdate: { createdAt: '2026-08-09T00:00:00.000Z' } }))).not.toBe(
      projectOrderSignature(items),
    )
  })

  it('changes when a latestUpdate appears or disappears', () => {
    const cleared = projectOrderSignature(withPatch(0, { latestUpdate: null }))
    const added = projectOrderSignature(withPatch(1, { latestUpdate: { createdAt: '2026-08-06T00:00:00.000Z' } }))
    expect(cleared).not.toBe(projectOrderSignature(items))
    expect(added).not.toBe(projectOrderSignature(items))
  })

  it('changes when an item is dropped', () => {
    expect(projectOrderSignature(items.slice(1))).not.toBe(projectOrderSignature(items))
  })

  it('is the empty string for an empty list', () => {
    expect(projectOrderSignature([])).toBe('')
  })

  it('does not mutate the input array', () => {
    const input = [...items].reverse()
    const order = input.map((i) => i.id)
    projectOrderSignature(input)
    expect(input.map((i) => i.id)).toEqual(order)
  })
})
