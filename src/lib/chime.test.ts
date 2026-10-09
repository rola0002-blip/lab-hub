import { describe, it, expect } from 'vitest'
import { shouldChime, shouldPingFromMessage, alertRendering, decideAlert } from './chime'
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
  it('every qualifying message alerts — no burst throttle', () => {
    const m = { cid: 'c1', authorId: 'other', muted: false }
    const opts = { openCid: null, focused: false, selfId: 'me' }
    expect(shouldPingFromMessage(m, opts)).toBe(true)
    expect(shouldPingFromMessage({ ...m }, opts)).toBe(true) // second message 1 ms later also pings
  })
})

describe('alertRendering', () => {
  it('browser/PWA: chime yes, toast no', () => {
    expect(alertRendering(false)).toEqual({ chime: true, toast: false })
  })

  it('desktop shell: OS-sounded toast yes, in-page chime suppressed (no double-ding)', () => {
    expect(alertRendering(true)).toEqual({ chime: false, toast: true })
  })
})

describe('decideAlert', () => {
  it('non-qualifying message → no alert on any surface', () => {
    expect(decideAlert(false, false)).toEqual({ chime: false, toast: false, popup: false, swPopup: false })
    expect(decideAlert(false, true)).toEqual({ chime: false, toast: false, popup: false, swPopup: false })
  })

  it('qualifying, browser tab → chime + constructor popup arm', () => {
    expect(decideAlert(true, false)).toEqual({ chime: true, toast: false, popup: true, swPopup: false })
  })

  it('qualifying, standalone PWA → chime + SW popup arm (constructor throws on installed iOS/Android)', () => {
    expect(decideAlert(true, false, true)).toEqual({ chime: true, toast: false, popup: false, swPopup: true })
  })

  it('qualifying, desktop shell → OS-sounded toast only (popup never fires in-shell)', () => {
    expect(decideAlert(true, true)).toEqual({ chime: false, toast: true, popup: false, swPopup: false })
  })

  it('shell outranks standalone (the shell marker wins even if both read true)', () => {
    expect(decideAlert(true, true, true)).toEqual({ chime: false, toast: true, popup: false, swPopup: false })
  })

  it('two SSE messages within 3 s both alert — the old burst throttle is gone', () => {
    const m = { cid: 'c1', authorId: 'other', muted: false }
    const opts = { openCid: null, focused: false, selfId: 'me' }
    expect(decideAlert(shouldPingFromMessage(m, opts), false))
      .toEqual({ chime: true, toast: false, popup: true, swPopup: false })
    expect(decideAlert(shouldPingFromMessage({ ...m }, opts), false))
      .toEqual({ chime: true, toast: false, popup: true, swPopup: false })
  })
})
