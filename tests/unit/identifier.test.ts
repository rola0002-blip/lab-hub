import { describe, it, expect } from 'vitest'
import { ISSUE_PREFIX, formatIdentifier, parseIdentifier, extractIssueRefNumbers } from '@/features/issues/identifier'

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
  it('rejects numbers above the Postgres int4 max (S1 — would 500 the read paths)', () => {
    expect(parseIdentifier('COL-2147483647')).toBe(2147483647) // int4 max is a valid boundary
    expect(parseIdentifier('COL-2147483648')).toBeNull()        // one past → rejected, not a DB error
    expect(parseIdentifier('COL-9999999999')).toBeNull()
  })
})

describe('extractIssueRefNumbers (int4 bound)', () => {
  it('drops out-of-int4-range refs so resolveIssueRefs never hits a range error', () => {
    expect(extractIssueRefNumbers('ok COL-7 bad COL-9999999999 edge COL-2147483647'))
      .toEqual([7, 2147483647])
  })
})
