import { describe, it, expect } from 'vitest'
import { parseNameWidth, clampNameWidth, nudgeNameWidth, NAME_WIDTH_MIN, NAME_WIDTH_MAX } from '@/features/documents/name-width'

describe('parseNameWidth', () => {
  it('reads unset and garbage as null', () => {
    expect(parseNameWidth(null)).toBeNull()
    expect(parseNameWidth('')).toBeNull()
    expect(parseNameWidth('abc')).toBeNull()
  })
  it('rejects fractional and out-of-range values', () => {
    expect(parseNameWidth('240.5')).toBeNull()
    expect(parseNameWidth('239')).toBeNull()
    expect(parseNameWidth('721')).toBeNull()
  })
  it('accepts integers across the full range', () => {
    expect(parseNameWidth('240')).toBe(240)
    expect(parseNameWidth(String(NAME_WIDTH_MAX))).toBe(NAME_WIDTH_MAX)
  })
})

describe('clampNameWidth', () => {
  it('maps non-finite input to the floor and caps at the ceiling', () => {
    expect(clampNameWidth(NaN)).toBe(240)
    expect(clampNameWidth(Infinity)).toBe(720)
  })
  it('clamps into the range and rounds to integers', () => {
    expect(clampNameWidth(-10)).toBe(240)
    expect(clampNameWidth(1000)).toBe(720)
    expect(clampNameWidth(300.4)).toBe(300)
    expect(clampNameWidth(NAME_WIDTH_MIN)).toBe(NAME_WIDTH_MIN)
  })
})

describe('nudgeNameWidth', () => {
  it('nudges from unset by the delta', () => {
    expect(nudgeNameWidth(null, 24)).toBe(264)
  })
  it('nudging below the floor resets to null (the keyboard double-click)', () => {
    expect(nudgeNameWidth(250, -24)).toBeNull()
  })
  it('landing exactly on the floor stays 240 (only strictly-below resets)', () => {
    expect(nudgeNameWidth(264, -24)).toBe(240)
  })
  it('nudging past the ceiling clamps', () => {
    expect(nudgeNameWidth(710, 24)).toBe(720)
  })
  it('nudges within range', () => {
    expect(nudgeNameWidth(300, -24)).toBe(276)
  })
})
