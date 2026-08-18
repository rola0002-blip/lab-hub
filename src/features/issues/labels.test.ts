import { describe, it, expect } from 'vitest'
import { nextLabelColor, splitLabelsForProject } from './labels'
import { LABEL_PALETTE } from './status'

describe('nextLabelColor', () => {
  it('cycles the fixed palette by scope count (spec §3.3)', () => {
    expect(nextLabelColor(0)).toBe(LABEL_PALETTE[0])
    expect(nextLabelColor(1)).toBe(LABEL_PALETTE[1])
    expect(nextLabelColor(5)).toBe(LABEL_PALETTE[5])
  })

  it('wraps around past the palette length', () => {
    expect(nextLabelColor(6)).toBe(LABEL_PALETTE[0])
    expect(nextLabelColor(13)).toBe(LABEL_PALETTE[13 % LABEL_PALETTE.length])
  })
})

describe('splitLabelsForProject', () => {
  const rows = [
    { id: 'g1', name: 'global-a', color: '--status-todo', projectId: null },
    { id: 'g2', name: 'global-b', color: '--status-done', projectId: null },
    { id: 'p1', name: 'own', color: '--status-backlog', projectId: 'P1' },
    { id: 'p2', name: 'foreign', color: '--status-canceled', projectId: 'P2' },
  ]

  it("keeps globals plus the destination project's own labels", () => {
    const { keep, drop } = splitLabelsForProject(rows, 'P1')
    expect(keep.map((l) => l.id)).toEqual(['g1', 'g2', 'p1'])
    expect(drop.map((l) => l.id)).toEqual(['p2'])
  })

  it('moving to no project keeps only workspace globals', () => {
    const { keep, drop } = splitLabelsForProject(rows, null)
    expect(keep.map((l) => l.id)).toEqual(['g1', 'g2'])
    expect(drop.map((l) => l.id)).toEqual(['p1', 'p2'])
  })

  it('an empty set splits into two empties', () => {
    expect(splitLabelsForProject([], 'P1')).toEqual({ keep: [], drop: [] })
  })
})
