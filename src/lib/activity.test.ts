import { describe, it, expect, beforeEach } from 'vitest'
import { noteActivity, isActive, ACTIVITY_IDLE_MS, _resetActivityForTests } from './activity'

describe('activity map', () => {
  beforeEach(_resetActivityForTests)

  it('unknown user is idle (not active)', () => {
    expect(isActive('u1')).toBe(false)
  })

  it('fresh activity is active; stale activity is idle', () => {
    const t0 = 1_000_000
    noteActivity('u1', t0)
    expect(isActive('u1', t0 + 1)).toBe(true)
    expect(isActive('u1', t0 + ACTIVITY_IDLE_MS - 1)).toBe(true)
    expect(isActive('u1', t0 + ACTIVITY_IDLE_MS)).toBe(false)
    expect(isActive('u1', t0 + ACTIVITY_IDLE_MS + 1)).toBe(false)
  })

  it('any tab reporting refreshes the window', () => {
    noteActivity('u1', 0)
    noteActivity('u1', ACTIVITY_IDLE_MS) // a second tab keeps the user active
    expect(isActive('u1', ACTIVITY_IDLE_MS + 10)).toBe(true)
  })
})
