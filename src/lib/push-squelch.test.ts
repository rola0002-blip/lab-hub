import { describe, it, expect, beforeEach } from 'vitest'
import { canPushNow, SQUELCH_WINDOW_MS, _resetSquelchForTests } from './push-squelch'

describe('push squelch', () => {
  beforeEach(_resetSquelchForTests)

  it('first push is allowed and reserves the window', () => {
    expect(canPushNow('u', 'c', 0)).toBe(true)
    expect(canPushNow('u', 'c', SQUELCH_WINDOW_MS - 1)).toBe(false)
    expect(canPushNow('u', 'c', SQUELCH_WINDOW_MS)).toBe(true) // window expired
  })

  it('windows are per (user, conversation)', () => {
    expect(canPushNow('u', 'c1', 0)).toBe(true)
    expect(canPushNow('u', 'c2', 1)).toBe(true) // different conversation
    expect(canPushNow('other', 'c1', 2)).toBe(true) // different user
  })

  it('dropped hits do not extend the window', () => {
    expect(canPushNow('u', 'c', 0)).toBe(true)
    expect(canPushNow('u', 'c', 10_000)).toBe(false) // dropped — must not re-record
    expect(canPushNow('u', 'c', SQUELCH_WINDOW_MS)).toBe(true) // measured from t=0
  })
})
