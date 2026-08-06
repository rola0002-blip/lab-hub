import type { Role } from '@/lib/session'
import { PolicyError, policyStatus } from '@/features/issues/issue-policy'

// The feedback permission choke point. Reuses the generic PolicyError/policyStatus
// from issue-policy (assert-then-throw; routes/actions map .code → 403/404/400).
// Client-safe: this module imports NOTHING server-only (the /feedback client
// component imports the predicates for cosmetic gating, the Files precedent).
// The real gate is the assert* helpers on the server. The messages live HERE
// because the server actions surface them verbatim as toasts.
export { PolicyError, policyStatus }

// Submitting is open to every authenticated role — guests included (the deliberate
// divergence from the issue composer's guest gate). Banned users cannot sign in and
// the bot has no Account, so no further exclusion is needed. Spelled out as a
// whitelist rather than `return true`: a session carrying an unrecognised role
// string is denied instead of silently admitted.
export function canSubmitFeedback(role: Role): boolean {
  return role === 'admin' || role === 'member' || role === 'guest'
}
export function assertCanSubmitFeedback(role: Role): void {
  if (!canSubmitFeedback(role)) throw new PolicyError('forbidden', 'Your account cannot submit feedback.')
}

// The review queue, status changes and the admin delete arm are admin-only.
export function canReviewFeedback(role: Role): boolean {
  return role === 'admin'
}
export function assertCanReviewFeedback(role: Role): void {
  if (!canReviewFeedback(role)) throw new PolicyError('forbidden', 'Only admins can review feedback.')
}

// Delete = admin, or the author while the item is still NEW. Once review has
// started (any status ≠ NEW) the item is part of the record and only an admin may
// remove it; editing does not exist, so delete-and-resubmit is the correction path.
export function canDeleteFeedback(user: { id: string; role: Role }, fb: { authorId: string; status: string }): boolean {
  return user.role === 'admin' || (fb.authorId === user.id && fb.status === 'NEW')
}
export function assertCanDeleteFeedback(user: { id: string; role: Role }, fb: { authorId: string; status: string }): void {
  if (!canDeleteFeedback(user, fb)) throw new PolicyError('forbidden', 'Only an admin or the author (while it is still New) can delete this feedback.')
}

// The five-state workflow, in display order. Structurally identical to Prisma's
// FeedbackStatus enum, but declared here so client-safe consumers get the union
// without importing the Prisma client.
export const FEEDBACK_STATUSES = ['NEW', 'REVIEWED', 'PLANNED', 'DONE', 'DECLINED'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

// Runtime validation of a status arriving over the wire (the SP8 `weeks: 1 | 4`
// idiom): callers reject anything else with PolicyError('invalid') → 400.
export function isFeedbackStatus(s: string): s is FeedbackStatus {
  return (FEEDBACK_STATUSES as readonly string[]).includes(s)
}

// pagePath is captured client-side and is therefore untrusted: keep pathname+search
// only (fragments are never sent to a server anyway, so a fragment here means the
// client supplied it), require a leading slash — which drops any origin — and cap at
// 300. Stored as data and rendered as text, never navigated to.
export function normalizePagePath(s: string): string {
  const withoutFragment = s.split('#')[0]
  if (!withoutFragment.startsWith('/')) return '/'
  return withoutFragment.slice(0, 300)
}
