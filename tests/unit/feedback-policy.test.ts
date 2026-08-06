import { describe, it, expect } from 'vitest'
import type { Role } from '@/lib/session'
import { PolicyError as IssuePolicyError } from '@/features/issues/issue-policy'
import {
  PolicyError,
  policyStatus,
  canSubmitFeedback,
  assertCanSubmitFeedback,
  canReviewFeedback,
  assertCanReviewFeedback,
  canDeleteFeedback,
  assertCanDeleteFeedback,
  FEEDBACK_STATUSES,
  isFeedbackStatus,
  normalizePagePath,
} from '@/features/feedback/feedback-policy'

const ROLES: Role[] = ['admin', 'member', 'guest']
const NON_NEW = ['REVIEWED', 'PLANNED', 'DONE', 'DECLINED'] as const

describe('feedback-policy', () => {
  it('re-exports the shared error contract (same class, not a copy)', () => {
    expect(PolicyError).toBe(IssuePolicyError)
    expect(policyStatus('forbidden')).toBe(403)
    expect(policyStatus('not_found')).toBe(404)
    expect(policyStatus('invalid')).toBe(400)
  })

  it('every authenticated role may submit — guests included', () => {
    for (const role of ROLES) {
      expect(canSubmitFeedback(role)).toBe(true)
      expect(() => assertCanSubmitFeedback(role)).not.toThrow()
    }
  })

  it('submission is a whitelist, not a tautology: an unknown role string is denied', () => {
    expect(canSubmitFeedback('robot' as Role)).toBe(false)
    try {
      assertCanSubmitFeedback('robot' as Role)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyError)
      expect((e as PolicyError).code).toBe('forbidden')
    }
  })

  it('reviewing the queue is admin-only', () => {
    expect(canReviewFeedback('admin')).toBe(true)
    expect(canReviewFeedback('member')).toBe(false)
    expect(canReviewFeedback('guest')).toBe(false)
    expect(() => assertCanReviewFeedback('admin')).not.toThrow()
    try {
      assertCanReviewFeedback('member')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyError)
      expect((e as PolicyError).code).toBe('forbidden')
    }
  })

  it('an admin may delete any item at any status', () => {
    for (const status of FEEDBACK_STATUSES) {
      expect(canDeleteFeedback({ id: 'a1', role: 'admin' }, { authorId: 'u1', status })).toBe(true)
    }
  })

  it('the author may delete their own item only while it is NEW', () => {
    expect(canDeleteFeedback({ id: 'u1', role: 'member' }, { authorId: 'u1', status: 'NEW' })).toBe(true)
    expect(canDeleteFeedback({ id: 'g1', role: 'guest' }, { authorId: 'g1', status: 'NEW' })).toBe(true)
    // Once review has started the item is part of the record — only an admin may remove it.
    for (const status of NON_NEW) {
      expect(canDeleteFeedback({ id: 'u1', role: 'member' }, { authorId: 'u1', status })).toBe(false)
      expect(canDeleteFeedback({ id: 'g1', role: 'guest' }, { authorId: 'g1', status })).toBe(false)
    }
  })

  it('a non-author non-admin may never delete', () => {
    for (const status of FEEDBACK_STATUSES) {
      expect(canDeleteFeedback({ id: 'u2', role: 'member' }, { authorId: 'u1', status })).toBe(false)
      expect(canDeleteFeedback({ id: 'g2', role: 'guest' }, { authorId: 'u1', status })).toBe(false)
    }
  })

  it('assertCanDeleteFeedback passes the author while NEW and throws forbidden once reviewed', () => {
    expect(() => assertCanDeleteFeedback({ id: 'u1', role: 'member' }, { authorId: 'u1', status: 'NEW' })).not.toThrow()
    expect(() => assertCanDeleteFeedback({ id: 'a1', role: 'admin' }, { authorId: 'u1', status: 'DONE' })).not.toThrow()
    try {
      assertCanDeleteFeedback({ id: 'u1', role: 'member' }, { authorId: 'u1', status: 'REVIEWED' })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyError)
      expect((e as PolicyError).code).toBe('forbidden')
    }
  })

  it('FEEDBACK_STATUSES is the five-state workflow in order', () => {
    expect(FEEDBACK_STATUSES).toEqual(['NEW', 'REVIEWED', 'PLANNED', 'DONE', 'DECLINED'])
  })

  it('isFeedbackStatus accepts the five and rejects anything else', () => {
    for (const s of FEEDBACK_STATUSES) expect(isFeedbackStatus(s)).toBe(true)
    for (const s of ['', 'new', 'ARCHIVED', 'NEW ', 'null', 'REVIEWED,DONE']) expect(isFeedbackStatus(s)).toBe(false)
  })

  it('normalizePagePath keeps a real pathname + search untouched', () => {
    expect(normalizePagePath('/')).toBe('/')
    expect(normalizePagePath('/a?b=c')).toBe('/a?b=c')
    expect(normalizePagePath('/issues/LAB-12')).toBe('/issues/LAB-12')
  })

  it('normalizePagePath strips the fragment', () => {
    expect(normalizePagePath('/a#frag')).toBe('/a')
    expect(normalizePagePath('/a?b=c#frag')).toBe('/a?b=c')
    expect(normalizePagePath('/a#b#c')).toBe('/a')
    expect(normalizePagePath('#frag')).toBe('/')
  })

  it('normalizePagePath falls back to / for anything without a leading slash', () => {
    expect(normalizePagePath('x')).toBe('/')
    expect(normalizePagePath('')).toBe('/')
    // An origin is never stored — a hostile client cannot smuggle one in.
    expect(normalizePagePath('https://evil.example/x')).toBe('/')
  })

  it('normalizePagePath slices to 300 characters', () => {
    const long = '/' + 'a'.repeat(349)
    expect(long.length).toBe(350)
    expect(normalizePagePath(long)).toBe(long.slice(0, 300))
    expect(normalizePagePath(long).length).toBe(300)
    // Exactly at the cap is untouched.
    const at = '/' + 'a'.repeat(299)
    expect(normalizePagePath(at)).toBe(at)
  })
})
