import { describe, it, expect, beforeEach } from 'vitest'
import {
  FEEDBACK_RATE_MAX,
  FEEDBACK_RATE_WINDOW_MS,
  checkFeedbackRate,
  resetFeedbackRate,
} from '@/features/feedback/rate-limit'

const T0 = 1_700_000_000_000

describe('feedback rate limit', () => {
  beforeEach(() => {
    resetFeedbackRate()
  })

  it('pins the documented budget: 5 submissions / 600 s', () => {
    expect(FEEDBACK_RATE_MAX).toBe(5)
    expect(FEEDBACK_RATE_WINDOW_MS).toBe(600_000)
  })

  it('admits FEEDBACK_RATE_MAX submissions inside the window and rejects the next', () => {
    for (let i = 0; i < FEEDBACK_RATE_MAX; i++) expect(checkFeedbackRate('u1', T0 + i)).toBe(true)
    expect(checkFeedbackRate('u1', T0 + FEEDBACK_RATE_MAX)).toBe(false)
  })

  it('readmits once the window has slid past the oldest entry', () => {
    for (let i = 0; i < FEEDBACK_RATE_MAX; i++) checkFeedbackRate('u1', T0)
    expect(checkFeedbackRate('u1', T0)).toBe(false)
    // Still inside the window one millisecond early...
    expect(checkFeedbackRate('u1', T0 + FEEDBACK_RATE_WINDOW_MS - 1)).toBe(false)
    // ...and rejected attempts do not extend the block (they are never recorded).
    expect(checkFeedbackRate('u1', T0 + FEEDBACK_RATE_WINDOW_MS + 1)).toBe(true)
  })

  it('is per-user: one user exhausting the budget does not block another', () => {
    for (let i = 0; i < FEEDBACK_RATE_MAX; i++) expect(checkFeedbackRate('u1', T0)).toBe(true)
    expect(checkFeedbackRate('u1', T0)).toBe(false)
    expect(checkFeedbackRate('u2', T0)).toBe(true)
  })

  it('resetFeedbackRate clears every user (test isolation hook)', () => {
    for (let i = 0; i < FEEDBACK_RATE_MAX; i++) checkFeedbackRate('u1', T0)
    expect(checkFeedbackRate('u1', T0)).toBe(false)
    resetFeedbackRate()
    expect(checkFeedbackRate('u1', T0)).toBe(true)
  })

  it('defaults to the wall clock when now is omitted', () => {
    for (let i = 0; i < FEEDBACK_RATE_MAX; i++) expect(checkFeedbackRate('u1')).toBe(true)
    expect(checkFeedbackRate('u1')).toBe(false)
  })
})
