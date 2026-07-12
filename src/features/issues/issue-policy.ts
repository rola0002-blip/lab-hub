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
export function canManageProjects(role: Role): boolean {
  return role === 'admin' || role === 'member'
}
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

export function policyStatus(code: PolicyError['code']): number {
  return code === 'forbidden' ? 403 : code === 'not_found' ? 404 : 400
}
