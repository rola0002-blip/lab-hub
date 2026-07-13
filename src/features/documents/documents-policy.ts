import type { Role } from '@/lib/session'
import { PolicyError, policyStatus } from '@/features/issues/issue-policy'

// The Files permission choke point. Reuses the generic PolicyError/policyStatus from
// issue-policy (assert-then-throw; routes/actions map .code → 403/404/400). Client-
// safe: this module imports NOTHING server-only (FilesClient imports the predicates
// for cosmetic gating). The real gate is the assert* helpers on the server.
export { PolicyError, policyStatus }

// browse / search / download = any authenticated user incl. guests (no role gate).
// upload / rename / move / create folder = admin or member.
export function canUpload(role: Role): boolean {
  return role === 'admin' || role === 'member'
}
export function assertCanUpload(role: Role): void {
  if (!canUpload(role)) throw new PolicyError('forbidden', 'Guests cannot upload or edit files.')
}

// delete file = uploader or admin (the canDeleteComment author-or-admin precedent).
export function canDeleteDocument(role: Role, uploaderId: string, userId: string): boolean {
  return uploaderId === userId || role === 'admin'
}
export function assertCanDeleteDocument(role: Role, uploaderId: string, userId: string): void {
  if (!canDeleteDocument(role, uploaderId, userId)) throw new PolicyError('forbidden', 'Only the uploader or an admin can delete this file.')
}

// folder rename / delete = creator or admin.
export function canManageFolder(role: Role, createdById: string, userId: string): boolean {
  return createdById === userId || role === 'admin'
}
export function assertCanManageFolder(role: Role, createdById: string, userId: string): void {
  if (!canManageFolder(role, createdById, userId)) throw new PolicyError('forbidden', 'Only the folder creator or an admin can rename or delete this folder.')
}
