import { describe, it, expect } from 'vitest'
import { shouldChime } from './chime'
const item = (id: string, type: string, createdAt: string) => ({ id, type, createdAt })

describe('shouldChime', () => {
  it('first load initializes the watermark silently', () => {
    const r = shouldChime(null, [item('1', 'message_dm', '2026-01-01T00:00:00.000Z')])
    expect(r).toEqual({ chime: false, watermark: '2026-01-01T00:00:00.000Z' })
  })
  it('chimes only for chat-type rows newer than the watermark', () => {
    const w = '2026-01-01T00:00:00.000Z'
    expect(shouldChime(w, [item('2', 'message_dm', '2026-01-01T00:01:00.000Z')]).chime).toBe(true)
    expect(shouldChime(w, [item('2', 'issue_assigned', '2026-01-01T00:01:00.000Z')]).chime).toBe(false)
    expect(shouldChime(w, [item('0', 'message_dm', '2025-12-31T23:00:00.000Z')]).chime).toBe(false)
  })
  it('advances the watermark past non-chime types too', () => {
    const r = shouldChime('2026-01-01T00:00:00.000Z', [item('2', 'booking_reminder', '2026-01-02T00:00:00.000Z')])
    expect(r).toEqual({ chime: false, watermark: '2026-01-02T00:00:00.000Z' })
  })
})
