import { describe, it, expect } from 'vitest'
import { shouldChime } from './chime'
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
