import { describe, it, expect } from 'vitest'
import {
  PolicyError,
  assertCanMutate,
  canMutateIssues,
  canManageProjects,
  canDeleteProject,
  canEditComment,
  canDeleteComment,
  policyStatus,
} from '@/features/issues/issue-policy'

describe('issue-policy', () => {
  it('members and admins may mutate; guests are blocked with a typed 403', () => {
    expect(() => assertCanMutate('admin')).not.toThrow()
    expect(() => assertCanMutate('member')).not.toThrow()
    try { assertCanMutate('guest'); throw new Error('should have thrown') }
    catch (e) { expect(e).toBeInstanceOf(PolicyError); expect((e as PolicyError).code).toBe('forbidden') }
  })
  it('exposes the mutate predicate directly (admins + members only)', () => {
    expect(canMutateIssues('admin')).toBe(true)
    expect(canMutateIssues('member')).toBe(true)
    expect(canMutateIssues('guest')).toBe(false)
  })
  it('project management (create/edit) is admins + members; guests excluded', () => {
    expect(canManageProjects('admin')).toBe(true)
    expect(canManageProjects('member')).toBe(true)
    expect(canManageProjects('guest')).toBe(false)
  })
  it('project deletion is admin-only', () => {
    expect(canDeleteProject('admin')).toBe(true)
    expect(canDeleteProject('member')).toBe(false)
    expect(canDeleteProject('guest')).toBe(false)
  })
  it('comment edit is author-only; delete is author-or-admin', () => {
    expect(canEditComment('member', 'u1', 'u1')).toBe(true)
    expect(canEditComment('admin', 'u1', 'u2')).toBe(false)   // admins cannot EDIT others' comments
    expect(canDeleteComment('member', 'u1', 'u1')).toBe(true) // author
    expect(canDeleteComment('admin', 'u1', 'u2')).toBe(true)  // admin may delete any
    expect(canDeleteComment('member', 'u1', 'u2')).toBe(false)
  })
  it('maps codes to HTTP statuses', () => {
    expect(policyStatus('forbidden')).toBe(403)
    expect(policyStatus('not_found')).toBe(404)
    expect(policyStatus('invalid')).toBe(400)
  })
})
