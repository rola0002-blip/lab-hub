import { describe, it, expect, beforeEach } from 'vitest'
import { checkRate, resetRate } from './rate-limit'

describe('checkRate', () => {
  beforeEach(resetRate)
  it('allows 30 sends then blocks within the window', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 30; i++) expect(checkRate('u1', t0 + i)).toBe(true)
    expect(checkRate('u1', t0 + 31)).toBe(false)
  })
  it('window slides: old sends expire after 60s', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 30; i++) checkRate('u1', t0 + i * 10)
    expect(checkRate('u1', t0 + 60_001)).toBe(true) // first send aged out
  })
  it('is per-user', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 30; i++) checkRate('u1', t0)
    expect(checkRate('u2', t0)).toBe(true)
  })
})
