import { describe, it, expect } from 'vitest'
import { shouldChime, shouldPingFromMessage, PingThrottle } from './chime'
const item = (id: string, type: string, createdAt: string) => ({ id, type, createdAt })

describe('shouldChime', () => {
  it('first load initializes the watermark silently', () => {
    const r = shouldChime(null, [item('1', 'message_dm', '2026-01-01T00:00:00.000Z')])
    expect(r).toEqual({ chime: false, watermark: '2026-01-01T00:00:00.000Z', hits: [] })
  })
  it('chimes only for chat-type rows newer than the watermark', () => {
    const w = '2026-01-01T00:00:00.000Z'
    expect(shouldChime(w, [item('2', 'message_dm', '2026-01-01T00:01:00.000Z')]).chime).toBe(true)
    expect(shouldChime(w, [item('2', 'issue_assigned', '2026-01-01T00:01:00.000Z')]).chime).toBe(false)
    expect(shouldChime(w, [item('0', 'message_dm', '2025-12-31T23:00:00.000Z')]).chime).toBe(false)
  })
  it('advances the watermark past non-chime types too', () => {
    const r = shouldChime('2026-01-01T00:00:00.000Z', [item('2', 'booking_reminder', '2026-01-02T00:00:00.000Z')])
    expect(r).toEqual({ chime: false, watermark: '2026-01-02T00:00:00.000Z', hits: [] })
  })
  it('newest-first mixed batch: a newer non-chat row must not shadow an older unseen chat row', () => {
    // Regression: the old loop compared against the RUNNING max, so the newer
    // booking_reminder (first in a newest-first batch) silenced the message_dm.
    const r = shouldChime('2026-01-01T00:00:00.000Z', [
      item('2', 'booking_reminder', '2026-01-01T00:05:00.000Z'),
      item('1', 'message_dm', '2026-01-01T00:04:00.000Z'),
    ])
    expect(r).toEqual({ chime: true, watermark: '2026-01-01T00:05:00.000Z', hits: [item('1', 'message_dm', '2026-01-01T00:04:00.000Z')] })
  })
  it('hits list only the unseen chat rows, in batch order (feeds the desktop-shell toast)', () => {
    const w = '2026-01-01T00:00:00.000Z'
    const r = shouldChime(w, [
      item('3', 'message_dm', '2026-01-01T00:03:00.000Z'),
      item('2', 'issue_assigned', '2026-01-01T00:02:00.000Z'),
      item('1', 'message_mention', '2026-01-01T00:01:00.000Z'),
      item('0', 'message_dm', '2025-12-31T23:00:00.000Z'),
    ])
    expect(r.chime).toBe(true)
    expect(r.hits).toEqual([
      item('3', 'message_dm', '2026-01-01T00:03:00.000Z'),
      item('1', 'message_mention', '2026-01-01T00:01:00.000Z'),
    ])
  })
})

describe('shouldPingFromMessage', () => {
  const opts = { openCid: 'c1', focused: true, selfId: 'me' }
  const base = { cid: 'c2', authorId: 'other', kind: 'text', muted: false }

  it('pings for a plain message in another conversation (focused or not)', () => {
    expect(shouldPingFromMessage(base, opts)).toBe(true)
    expect(shouldPingFromMessage(base, { ...opts, focused: false })).toBe(true)
  })
  it('muted conversation → no ping', () => {
    expect(shouldPingFromMessage({ ...base, muted: true }, opts)).toBe(false)
  })
  it('system kind → no ping', () => {
    expect(shouldPingFromMessage({ ...base, kind: 'system' }, opts)).toBe(false)
  })
  it('own message (echo of what you sent) → no ping', () => {
    expect(shouldPingFromMessage({ ...base, authorId: 'me' }, opts)).toBe(false)
  })
  it('open + focused conversation → no ping (you are reading it)', () => {
    expect(shouldPingFromMessage({ ...base, cid: 'c1' }, opts)).toBe(false)
  })
  it('open but UNfocused conversation → ping (you are away from the window)', () => {
    expect(shouldPingFromMessage({ ...base, cid: 'c1' }, { ...opts, focused: false })).toBe(true)
  })
})

describe('PingThrottle', () => {
  // `last` starts at 0, so tests drive an explicit clock offset well past the
  // epoch (Date.now()-like), never t=0.
  const t0 = 1_000_000

  it('first canPing passes; an immediate second is swallowed', () => {
    const t = new PingThrottle(3000)
    expect(t.canPing(t0)).toBe(true)
    expect(t.canPing(t0 + 100)).toBe(false)
  })
  it('still blocked at window-1ms; free again at window+1ms', () => {
    const t = new PingThrottle(3000)
    t.canPing(t0)
    expect(t.canPing(t0 + 2999)).toBe(false)
    expect(t.canPing(t0 + 3001)).toBe(true)
  })
  it('a swallowed ping does NOT re-arm the window (swallow leaves `last` alone)', () => {
    // A hit at t0 arms the window; a hit at t0+1500 (0.5×window) is swallowed
    // and must not slide the window — otherwise a burst that straddles the
    // midpoint would mute the ping that follows the window.
    const t = new PingThrottle(3000)
    t.canPing(t0)
    expect(t.canPing(t0 + 1500)).toBe(false)
    // window is measured from the last EMITTED ping, not the swallowed hit
    expect(t.canPing(t0 + 3001)).toBe(true)
  })
})
