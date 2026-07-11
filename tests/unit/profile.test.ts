import { describe, it, expect } from 'vitest'
import { isValidDisplayName, isValidTitle, isSupportedTimezone } from '@/lib/profile'

describe('profile validators', () => {
  it('name: 1–80 chars after trim', () => {
    expect(isValidDisplayName('Roland')).toBe(true)
    expect(isValidDisplayName('  A  ')).toBe(true)
    expect(isValidDisplayName('   ')).toBe(false)
    expect(isValidDisplayName('')).toBe(false)
    expect(isValidDisplayName('x'.repeat(80))).toBe(true)
    expect(isValidDisplayName('x'.repeat(81))).toBe(false)
  })
  it('title: ≤100 chars after trim, empty allowed', () => {
    expect(isValidTitle('')).toBe(true)
    expect(isValidTitle('PhD candidate')).toBe(true)
    expect(isValidTitle('x'.repeat(100))).toBe(true)
    expect(isValidTitle('x'.repeat(101))).toBe(false)
  })
  it('timezone: validates against the IANA set', () => {
    expect(isSupportedTimezone('Asia/Singapore')).toBe(true)
    expect(isSupportedTimezone('America/New_York')).toBe(true)
    expect(isSupportedTimezone('Mars/Phobos')).toBe(false)
    expect(isSupportedTimezone('')).toBe(false)
  })
})
