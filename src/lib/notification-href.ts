// Pure resolver: map a notification (type + payload) to the in-app route its Bell
// row should navigate to, or null when nothing sensible resolves. Kept free of
// React so it is unit-testable and importable by the client <Bell> without a DOM.
//
// Payload keys are set by the notify() call sites (src/lib/notify.ts consumers):
//  - issue_*        → { identifier }                 → /issues/<identifier>
//  - message_dm|_mention → { conversationId, messageId } → /chat/<cid>?msg=<mid>
//  - channel_added  → { conversationId }             → /chat/<cid>
//  - project_update_prompt → { conversationId, messageId } → /chat/<cid>?msg=<mid> (chat-shaped; SP8)
//  - booking_*      → { message } only (no id)       → a pending request is actioned
//    in the approvals queue (it is sent to managers/admins); every other booking
//    event lands on the recipient's own bookings list.
//  - feedback_*     → { feedbackId, message }        → /feedback (v0.13). The route is
//    role-adaptive (admin queue / own submissions) and has no per-item anchor, so the
//    id rides along for the future without being resolved here.

export type NotificationLike = { type: string; payload?: Record<string, string> | null }

export function notificationHref(n: NotificationLike): string | null {
  const p = n.payload ?? {}
  // Issue rows carry a LAB-<n> identifier — link straight to the issue.
  if (typeof p.identifier === 'string' && p.identifier) return `/issues/${p.identifier}`
  // Chat rows carry a conversationId; deep-link to the specific message when present.
  if (typeof p.conversationId === 'string' && p.conversationId) {
    return typeof p.messageId === 'string' && p.messageId
      ? `/chat/${p.conversationId}?msg=${p.messageId}`
      : `/chat/${p.conversationId}`
  }
  // Booking rows carry no id: pending requests → approvals queue, the rest → bookings.
  if (n.type.startsWith('booking_')) return n.type === 'booking_pending' ? '/approvals' : '/bookings'
  // Feedback rows carry a feedbackId the page does not deep-link to: both the admin's
  // "new feedback" bell and the author's decision bell land on the one /feedback route.
  if (n.type.startsWith('feedback_')) return '/feedback'
  return null
}
