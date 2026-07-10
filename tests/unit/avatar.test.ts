import { describe, it, expect } from 'vitest'
import { initials, avatarHue } from '@/lib/avatar'

describe('avatar helpers', () => {
  it('derives 1-2 uppercase initials', () => {
    expect(initials('Roland Tay')).toBe('RT')
    expect(initials('wei lin chen')).toBe('WL')
    expect(initials('Amir')).toBe('A')
    expect(initials('  ')).toBe('?')
  })
  it('is deterministic and in range', () => {
    expect(avatarHue('abc')).toBe(avatarHue('abc'))
    for (const id of ['a', 'user_1', 'zzz']) {
      const h = avatarHue(id)
      expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(360)
    }
    expect(avatarHue('a')).not.toBe(avatarHue('b'))
  })
})
