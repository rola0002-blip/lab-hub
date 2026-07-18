import { describe, it, expect } from 'vitest'
import { ISSUE_PREFIX, formatIdentifier, parseIdentifier, extractIssueRefNumbers } from '@/features/issues/identifier'

describe('identifier', () => {
  it('formats LAB-<n>', () => {
    expect(ISSUE_PREFIX).toBe('LAB')
    expect(formatIdentifier(42)).toBe('LAB-42')
  })
  it('parses valid identifiers case-insensitively', () => {
    expect(parseIdentifier('LAB-42')).toBe(42)
    expect(parseIdentifier('lab-7')).toBe(7)
    expect(parseIdentifier('  LAB-100  ')).toBe(100)
  })
  // Backward-compat: the pre-rebrand COL- prefix still PARSES to the same number so
  // stale links (/issues/COL-n) and archived `COL-n` search queries keep resolving.
  it('parses the legacy COL- prefix as a read-only alias', () => {
    expect(parseIdentifier('COL-42')).toBe(42)
    expect(parseIdentifier('col-7')).toBe(7)
    expect(parseIdentifier('  COL-100  ')).toBe(100)
  })
  it('rejects malformed / non-positive / unknown-prefix identifiers', () => {
    for (const s of ['LAB', 'LAB-', 'LAB-0', 'LAB--1', 'LAB-1a', 'COL', 'XYZ-1', '42', 'LAB-1.5']) {
      expect(parseIdentifier(s)).toBeNull()
    }
  })
  it('rejects numbers past the safe-integer range', () => {
    expect(parseIdentifier('LAB-999999999999999999999')).toBeNull()
  })
  it('rejects numbers above the Postgres int4 max (S1 — would 500 the read paths)', () => {
    expect(parseIdentifier('LAB-2147483647')).toBe(2147483647) // int4 max is a valid boundary
    expect(parseIdentifier('LAB-2147483648')).toBeNull()        // one past → rejected, not a DB error
    expect(parseIdentifier('LAB-9999999999')).toBeNull()
  })
})

describe('extractIssueRefNumbers (int4 bound)', () => {
  it('drops out-of-int4-range refs so resolveIssueRefs never hits a range error', () => {
    expect(extractIssueRefNumbers('ok LAB-7 bad LAB-9999999999 edge LAB-2147483647'))
      .toEqual([7, 2147483647])
  })
  it('collects the legacy COL- alias alongside LAB- refs', () => {
    expect(extractIssueRefNumbers('new LAB-7 and archived COL-8')).toEqual([7, 8])
  })
})
