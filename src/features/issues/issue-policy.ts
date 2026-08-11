import type { Role } from '@/lib/session'

// The single permission choke point for SP4. Services throw PolicyError; route
// handlers/actions map .code to 400/403/404 (policyStatus), exactly as chat maps
// its typed errors. UI gating is cosmetic — this is the real gate.
export class PolicyError extends Error {
  constructor(public code: 'forbidden' | 'not_found' | 'invalid', message: string) {
    super(message)
    this.name = 'PolicyError'
  }
}

// Admins + members have full create/edit/assign/comment/label access. Guests are
// read-only: any mutation throws a typed 403.
export function canMutateIssues(role: Role): boolean {
  return role === 'admin' || role === 'member'
}
export function assertCanMutate(role: Role): void {
  if (!canMutateIssues(role)) throw new PolicyError('forbidden', 'Guests have read-only access to issues and projects.')
}

// Projects: create/edit by admins+members; deletion is admin-only.
export function canDeleteProject(role: Role): boolean {
  return role === 'admin'
}

// Comment edit is author-only; delete is author-or-admin.
export function canEditComment(_role: Role, authorId: string, userId: string): boolean {
  return authorId === userId
}
export function canDeleteComment(role: Role, authorId: string, userId: string): boolean {
  return authorId === userId || role === 'admin'
}

// Issue deletion is creator-or-admin — the canDeleteComment shape, plus an explicit
// guest bar. Deletion here is HARD and cascading, so a member demoted to guest must
// not keep it on issues they once filed; canDeleteComment's identical demoted-creator
// case is left alone (that delete is soft and recoverable) — spec §2.
export function canDeleteIssue(role: Role, creatorId: string, userId: string): boolean {
  return role !== 'guest' && (creatorId === userId || role === 'admin')
}
export function assertCanDeleteIssue(role: Role, creatorId: string, userId: string): void {
  if (!canDeleteIssue(role, creatorId, userId)) throw new PolicyError('forbidden', 'Only the issue’s creator or an admin can delete it.')
}

// Project updates (v0.15 §6.2), the comment shapes exactly: edit is author-only —
// an admin may retract someone else's update but never rewrite their words, since
// the row is a signed narrative record, not workspace furniture — and delete is
// author-or-admin. No explicit guest term (unlike canDeleteIssue): this delete is
// SOFT and recoverable, and assertCanMutate bars guests upstream of both.
export function canEditProjectUpdate(_role: Role, authorId: string, userId: string): boolean {
  return authorId === userId
}
export function canDeleteProjectUpdate(role: Role, authorId: string, userId: string): boolean {
  return authorId === userId || role === 'admin'
}

export function policyStatus(code: PolicyError['code']): number {
  return code === 'forbidden' ? 403 : code === 'not_found' ? 404 : 400
}
