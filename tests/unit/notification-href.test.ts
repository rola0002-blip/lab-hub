import { describe, it, expect } from 'vitest'
import { notificationHref } from '@/lib/notification-href'

// Regression (v0.9.5 fix 9): the Bell only linked issue rows; DM/mention/channel/
// booking rows were dead <div>s despite carrying the data to navigate. This resolver
// is the single source of truth for every row's target — reverting any arm below
// (e.g. dropping the conversationId branch) turns those rows dead again and fails here.
describe('notificationHref', () => {
  it('links issue notifications to the issue by identifier', () => {
    expect(notificationHref({ type: 'issue_assigned', payload: { identifier: 'LAB-12', issueId: 'i1' } })).toBe('/issues/LAB-12')
    expect(notificationHref({ type: 'issue_comment', payload: { identifier: 'LAB-3', issueId: 'i2' } })).toBe('/issues/LAB-3')
    expect(notificationHref({ type: 'issue_mention', payload: { identifier: 'LAB-9' } })).toBe('/issues/LAB-9')
    expect(notificationHref({ type: 'issue_done', payload: { identifier: 'LAB-1' } })).toBe('/issues/LAB-1')
  })

  it('deep-links DM and mention rows to the specific message', () => {
    expect(notificationHref({ type: 'message_dm', payload: { conversationId: 'c1', messageId: 'm1' } })).toBe('/chat/c1?msg=m1')
    expect(notificationHref({ type: 'message_mention', payload: { conversationId: 'c2', messageId: 'm9' } })).toBe('/chat/c2?msg=m9')
  })

  it('links channel_added to the conversation (no deep-link without a messageId)', () => {
    expect(notificationHref({ type: 'channel_added', payload: { conversationId: 'c5' } })).toBe('/chat/c5')
  })

  it('routes a pending booking to the approvals queue', () => {
    expect(notificationHref({ type: 'booking_pending', payload: { message: 'needs approval' } })).toBe('/approvals')
  })

  it('routes every other booking event to the bookings list', () => {
    for (const type of ['booking_decided', 'booking_reminder', 'booking_expired', 'booking_cancelled', 'booking_cancelled_maintenance']) {
      expect(notificationHref({ type, payload: { message: 'x' } })).toBe('/bookings')
    }
  })

  it('prefers the issue identifier when a row carries both keys', () => {
    expect(notificationHref({ type: 'issue_mention', payload: { identifier: 'LAB-7', conversationId: 'c1' } })).toBe('/issues/LAB-7')
  })

  it('routes a project_update_prompt row to the bot DM at the prompt message (SP8)', () => {
    expect(notificationHref({ type: 'project_update_prompt', payload: { message: 'Time for…', conversationId: 'c9', messageId: 'm4' } }))
      .toBe('/chat/c9?msg=m4') // shape-identical to the chat fan-out payload — NO resolver change
  })

  it('returns null when nothing resolves', () => {
    expect(notificationHref({ type: 'unknown_type', payload: {} })).toBeNull()
    expect(notificationHref({ type: 'message_dm', payload: {} })).toBeNull() // missing conversationId
    expect(notificationHref({ type: 'channel_added' })).toBeNull() // missing payload entirely
  })
})
