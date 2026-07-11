import { describe, it, expect } from 'vitest'
import { ACCENTS, DEFAULT_ACCENT, isAccentSlug } from '@/lib/accents'

describe('accents', () => {
  it('has 10 presets with unique slugs and light+dark hexes', () => {
    expect(ACCENTS).toHaveLength(10)
    expect(new Set(ACCENTS.map((a) => a.slug)).size).toBe(10)
    for (const a of ACCENTS) {
      expect(a.light).toMatch(/^#[0-9a-f]{6}$/)
      expect(a.dark).toMatch(/^#[0-9a-f]{6}$/)
      expect(a.name.length).toBeGreaterThan(0)
    }
  })
  it('defaults to teal, and teal is the first entry', () => {
    expect(DEFAULT_ACCENT).toBe('teal')
    expect(ACCENTS[0].slug).toBe('teal')
  })
  it('isAccentSlug guards real slugs only', () => {
    expect(isAccentSlug('crimson')).toBe(true)
    expect(isAccentSlug('teal')).toBe(true)
    expect(isAccentSlug('aubergine')).toBe(false)
    expect(isAccentSlug('')).toBe(false)
    expect(isAccentSlug(null)).toBe(false)
    expect(isAccentSlug(42)).toBe(false)
  })
})
