import { describe, it, expect } from 'vitest'
import { sumUnread } from '@/features/chat/unread'

// The sidebar total and the rail's per-row badge must agree at all times, and the
// rail never shows a count on a muted row (conversation-list.tsx:55-56). These cases
// pin that rule so the two can never drift apart again.
describe('sumUnread (v0.11 §3.1)', () => {
  it('is 0 for an empty list', () => {
    expect(sumUnread([])).toBe(0)
  })

  it('sums unmuted rows', () => {
    expect(sumUnread([{ unread: 3, muted: false }, { unread: 4, muted: false }, { unread: 0, muted: false }])).toBe(7)
  })

  it('excludes a muted row carrying a non-zero unread count', () => {
    expect(sumUnread([{ unread: 3, muted: false }, { unread: 99, muted: true }])).toBe(3)
  })

  it('excludes a muted row even when it carries mentions — the sum counts unread MESSAGES', () => {
    // Bound to a const first: a fresh array literal with the extra `mentions` key
    // would trip TypeScript's excess-property check at the call site.
    const rows = [{ unread: 5, muted: true, mentions: 2 }, { unread: 1, muted: false, mentions: 0 }]
    expect(sumUnread(rows)).toBe(1)
  })

  it('is 0 when every row is muted', () => {
    expect(sumUnread([{ unread: 8, muted: true }, { unread: 2, muted: true }])).toBe(0)
  })
})
