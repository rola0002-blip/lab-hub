import type { Role } from '@/lib/session'
import { PolicyError, policyStatus } from '@/features/issues/issue-policy'

// The RA-acknowledgment permission choke point (wave 9). Client-safe: imports
// nothing server-only; the /ra client imports the predicates for cosmetic
// gating, the real gate is the service's asserts.
export { PolicyError, policyStatus }

// The Files folder whose documents are acknowledgable risk assessments. Folder
// names are unique across the single level, so name equality IS identity here.
export const RA_FOLDER_NAME = 'RA'

// Every authenticated role may acknowledge (guests are often the external
// students doing the lab work) — the canSubmitFeedback whitelist shape.
export function canSubmitRa(role: Role): boolean {
  return role === 'admin' || role === 'member' || role === 'guest'
}
export function assertCanSubmitRa(role: Role): void {
  if (!canSubmitRa(role)) throw new PolicyError('forbidden', 'Your account cannot acknowledge RAs.')
}

// Records + CSV export are the admin's due-diligence view.
export function canReviewRa(role: Role): boolean {
  return role === 'admin'
}
export function assertCanReviewRa(role: Role): void {
  if (!canReviewRa(role)) throw new PolicyError('forbidden', 'Only admins can view RA records.')
}
