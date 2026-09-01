import { describe, it, expect, beforeEach } from 'vitest'
import { tryReservePush, SQUELCH_WINDOW_MS, MAX_ENTRIES, _resetSquelchForTests } from './push-squelch'

describe('push squelch', () => {
  beforeEach(_resetSquelchForTests)

  it('first push is allowed and reserves the window', () => {
    expect(tryReservePush('u', 'c', 0)).toBe(true)
    expect(tryReservePush('u', 'c', SQUELCH_WINDOW_MS - 1)).toBe(false)
    expect(tryReservePush('u', 'c', SQUELCH_WINDOW_MS)).toBe(true) // window expired
  })

  it('windows are per (user, conversation)', () => {
    expect(tryReservePush('u', 'c1', 0)).toBe(true)
    expect(tryReservePush('u', 'c2', 1)).toBe(true) // different conversation
    expect(tryReservePush('other', 'c1', 2)).toBe(true) // different user
  })

  it('dropped hits do not extend the window', () => {
    expect(tryReservePush('u', 'c', 0)).toBe(true)
    expect(tryReservePush('u', 'c', 10_000)).toBe(false) // dropped — must not re-record
    expect(tryReservePush('u', 'c', SQUELCH_WINDOW_MS)).toBe(true) // measured from t=0
  })

  it('evicts expired entries when the map exceeds MAX_ENTRIES (bounded memory)', () => {
    // Clock arithmetic (SQUELCH_WINDOW_MS = 60_000): the sweep runs on an
    // allowed call when map.size > MAX_ENTRIES, deleting entries with
    // now - t >= 60_000. So an entry recorded at t=0 is sweepable from
    // t=60_000 on, while one recorded at t=30_000 survives until t=90_000.
    // (a) Fill the map with MAX_ENTRIES + 1 distinct keys at t=0. No sweep
    //     fires mid-fill: size only reaches MAX_ENTRIES + 1 with the last set.
    for (let i = 0; i <= MAX_ENTRIES; i++) tryReservePush('u', `stale-${i}`, 0)
    // (b) Record 'kept' at t=30_000. This call sees size 50_001 > 50_000 and
    //     runs the sweep, but at t=30_000 nothing is 60_000 old yet, so all
    //     stale entries survive and 'kept' joins them (size 50_002).
    expect(tryReservePush('u', 'kept', 30_000)).toBe(true)
    // (c) At t=60_001 the sweep fires again: every t=0 entry is 60_001 >=
    //     60_000 old (evicted); 'kept' is 30_001 < 60_000 old (spared).
    expect(tryReservePush('u', 'trigger', 60_001)).toBe(true)
    expect(tryReservePush('u', 'kept', 60_002)).toBe(false) // survived the sweep
    expect(tryReservePush('u', 'stale-0', 60_003)).toBe(true) // expired either way; size below is the real eviction proof
    // The boolean return cannot distinguish "evicted" from merely "expired"
    // (a present-but-expired entry also returns true), so assert the reclaim
    // directly via the module's global cache: after the re-record above only
    // 'kept', 'trigger' and 'stale-0' remain — all 50_001 t=0 entries were
    // swept and memory stayed bounded.
    const squelchSize = () =>
      (globalThis as unknown as { labhubPushSquelch: Map<string, number> }).labhubPushSquelch.size
    expect(squelchSize()).toBe(3)
  })
})
