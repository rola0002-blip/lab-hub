import { describe, it, expect } from 'vitest'
import { nextRovingIndex } from '@/lib/roving'

describe('nextRovingIndex', () => {
  it('moves, clamps, and jumps', () => {
    expect(nextRovingIndex(2, 10, 'ArrowDown')).toBe(3)
    expect(nextRovingIndex(0, 10, 'ArrowUp')).toBe(0)
    expect(nextRovingIndex(9, 10, 'ArrowDown')).toBe(9)
    expect(nextRovingIndex(5, 10, 'Home')).toBe(0)
    expect(nextRovingIndex(5, 10, 'End')).toBe(9)
    expect(nextRovingIndex(5, 10, 'PageUp', 3)).toBe(2)
    expect(nextRovingIndex(1, 10, 'PageUp', 5)).toBe(0)
    expect(nextRovingIndex(0, 0, 'ArrowDown')).toBe(-1)
  })
})
