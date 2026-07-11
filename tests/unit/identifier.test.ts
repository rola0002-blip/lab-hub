import { describe, it, expect } from 'vitest'
import { ISSUE_PREFIX, formatIdentifier, parseIdentifier } from '@/features/issues/identifier'

describe('identifier', () => {
  it('formats COL-<n>', () => {
    expect(ISSUE_PREFIX).toBe('COL')
    expect(formatIdentifier(42)).toBe('COL-42')
  })
  it('parses valid identifiers case-insensitively', () => {
    expect(parseIdentifier('COL-42')).toBe(42)
    expect(parseIdentifier('col-7')).toBe(7)
    expect(parseIdentifier('  COL-100  ')).toBe(100)
  })
  it('rejects malformed / non-positive identifiers', () => {
    for (const s of ['COL', 'COL-', 'COL-0', 'COL--1', 'COL-1a', 'XYZ-1', '42', 'COL-1.5']) {
      expect(parseIdentifier(s)).toBeNull()
    }
  })
  it('rejects numbers past the safe-integer range', () => {
    expect(parseIdentifier('COL-999999999999999999999')).toBeNull()
  })
})
