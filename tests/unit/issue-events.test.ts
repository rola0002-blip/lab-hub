import { describe, it, expect } from 'vitest'
import { isIssueRefetchEvent } from '@/features/issues/issue-events'

// Regression (v0.9.5 fix 10): the issue list / board / detail views refetched on
// issue mutations but IGNORED the `reconnect` sentinel that every chat surface
// handles, so after a network blip they stayed stale. The `reconnect` case below
// is the one that fails against the pre-fix predicate.
describe('isIssueRefetchEvent', () => {
  it('refetches on every issue mutation event', () => {
    expect(isIssueRefetchEvent({ t: 'issue', id: 'i1' })).toBe(true)
    expect(isIssueRefetchEvent({ t: 'issue_move', id: 'i1', status: 'TODO', rank: 'a0' })).toBe(true)
    expect(isIssueRefetchEvent({ t: 'issue_comment', issueId: 'i1' })).toBe(true)
  })

  it('ALSO refetches on an SSE reconnect (re-syncs mutations missed during the outage)', () => {
    expect(isIssueRefetchEvent({ t: 'reconnect' })).toBe(true)
  })

  it('ignores chat / presence / notification frames (no needless issue refetch)', () => {
    expect(isIssueRefetchEvent({ t: 'msg', cid: 'c1', mid: 'm1' })).toBe(false)
    expect(isIssueRefetchEvent({ t: 'rx', cid: 'c1', mid: 'm1' })).toBe(false)
    expect(isIssueRefetchEvent({ t: 'notif', uid: 'u1' })).toBe(false)
    expect(isIssueRefetchEvent({ t: 'presence', uid: 'u1', online: true })).toBe(false)
    expect(isIssueRefetchEvent({ t: 'read', cid: 'c1', uid: 'u1' })).toBe(false)
    expect(isIssueRefetchEvent({ t: 'member', cid: 'c1', uid: 'u1' })).toBe(false)
    expect(isIssueRefetchEvent({ t: 'typing', cid: 'c1', uid: 'u1', name: 'A' })).toBe(false)
  })
})
