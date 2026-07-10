import { describe, it, expect } from 'vitest'
import { emojiFor, searchEmoji, EMOJI_MAP } from '@/features/chat/emoji'

describe('emojiFor', () => {
  it('resolves known shortnames to glyphs', () => {
    expect(emojiFor('tada')).toBe('🎉')
    expect(emojiFor('+1')).toBe('👍')
  })
  it('returns null for unknown shortnames', () => {
    expect(emojiFor('definitely_not_an_emoji')).toBeNull()
  })
})

describe('searchEmoji', () => {
  it('substring-matches shortnames (includes smile for "sm")', () => {
    expect(searchEmoji('sm').map((e) => e.shortname)).toContain('smile')
  })
  it('is case-insensitive and returns glyphs', () => {
    const r = searchEmoji('TADA')
    expect(r.some((e) => e.shortname === 'tada' && e.glyph === '🎉')).toBe(true)
  })
  it('returns an empty array when nothing matches', () => {
    expect(searchEmoji('zzzznope')).toEqual([])
  })
})

describe('EMOJI_MAP', () => {
  it('is a non-empty shortname → glyph map', () => {
    expect(Object.keys(EMOJI_MAP).length).toBeGreaterThan(50)
    expect(EMOJI_MAP.tada).toBe('🎉')
  })
})
