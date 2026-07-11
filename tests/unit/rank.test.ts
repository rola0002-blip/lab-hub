import { describe, it, expect } from 'vitest'
import { rankBetween, rebalance, REBALANCE_THRESHOLD } from '@/features/issues/rank'

describe('rankBetween', () => {
  it('orders start / between / end correctly', () => {
    const a = rankBetween(null, null)
    const before = rankBetween(null, a)
    const after = rankBetween(a, null)
    const mid = rankBetween(before, a)
    expect(before < a).toBe(true)
    expect(a < after).toBe(true)
    expect(before < mid && mid < a).toBe(true)
  })

  it('always produces a key strictly between two neighbours, repeatedly', () => {
    const lo = rankBetween(null, null)
    let hi = rankBetween(lo, null)
    for (let i = 0; i < 200; i++) {
      const m = rankBetween(lo, hi)
      expect(lo < m && m < hi).toBe(true)
      hi = m // keep splitting the left gap — the adversarial precision case
    }
  })

  it('splits the right gap repeatedly too (upper stays open)', () => {
    let lo = rankBetween(null, null)
    const hi = rankBetween(lo, null)
    for (let i = 0; i < 200; i++) {
      const m = rankBetween(lo, hi)
      expect(lo < m && m < hi).toBe(true)
      lo = m // squeeze toward hi from below
    }
  })

  it('walks past a run of top digits in the lower bound (precision exhaustion)', () => {
    // Lower bound ending in "z" (the highest digit) forces the adjacency branch
    // to append past each maxed-out digit before it can split.
    for (const lower of ['Vz', 'Vzz', 'Vzzz']) {
      const upper = 'W' // exactly one digit above 'V' at position 0 → adjacent
      const m = rankBetween(lower, upper)
      expect(lower < m && m < upper).toBe(true)
      expect(m.startsWith(lower)).toBe(true)
      expect(m.endsWith('0')).toBe(false)
    }
  })

  it('never returns a key ending in the lowest digit', () => {
    for (const [l, u] of [[null, null], ['V', null], [null, 'V'], ['V', 'W'], ['V', 'V5']] as const) {
      expect(rankBetween(l, u).endsWith('0')).toBe(false)
    }
  })

  it('throws on non-strictly-ordered bounds', () => {
    expect(() => rankBetween('k', 'k')).toThrow()
    expect(() => rankBetween('k', 'V')).toThrow()
  })

  it('rebalance returns n strictly-ascending short keys', () => {
    expect(rebalance(0)).toEqual([])
    expect(rebalance(-3)).toEqual([])
    expect(rebalance(1)).toHaveLength(1)
    const keys = rebalance(50)
    expect(keys).toHaveLength(50)
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true)
    // A freshly rebalanced column has room to split again for a long time.
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThan(REBALANCE_THRESHOLD)
  })
})
