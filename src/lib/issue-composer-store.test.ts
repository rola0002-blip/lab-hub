import { describe, it, expect, beforeEach } from 'vitest'
import {
  openIssueComposer, closeIssueComposer, getIssueComposer,
  subscribeIssueComposer, resolveInitialAssignee,
} from './issue-composer-store'

describe('issue composer store', () => {
  beforeEach(() => closeIssueComposer())

  it('starts closed with an empty prefill', () => {
    expect(getIssueComposer()).toEqual({ open: false, prefill: {} })
  })

  it('open carries the prefill; close clears both open and prefill', () => {
    openIssueComposer({ title: 'Calibrate AFM', projectId: 'p1', assignToSelf: true })
    const s = getIssueComposer()
    expect(s.open).toBe(true)
    expect(s.prefill).toEqual({ title: 'Calibrate AFM', projectId: 'p1', assignToSelf: true })
    closeIssueComposer()
    expect(getIssueComposer()).toEqual({ open: false, prefill: {} })
  })

  it('notifies subscribers on open and close; unsubscribe stops delivery', () => {
    let hits = 0
    const unsub = subscribeIssueComposer(() => { hits++ })
    openIssueComposer({ assignToSelf: true })
    closeIssueComposer()
    expect(hits).toBe(2)
    unsub()
    openIssueComposer()
    expect(hits).toBe(2) // no further deliveries after unsubscribe
  })
})

describe('resolveInitialAssignee (quick-capture default)', () => {
  it('assignToSelf → the current user id', () => {
    expect(resolveInitialAssignee({ assignToSelf: true }, 'user-1')).toBe('user-1')
  })
  it('quick-capture prefill with other fields still resolves to self', () => {
    expect(resolveInitialAssignee({ title: 'x', originMessageId: 'm1', assignToSelf: true }, 'user-9')).toBe('user-9')
  })
  it('no assignToSelf (New issue button) → unassigned', () => {
    expect(resolveInitialAssignee({}, 'user-1')).toBeNull()
    expect(resolveInitialAssignee({ projectId: 'p1' }, 'user-1')).toBeNull()
    expect(resolveInitialAssignee({ assignToSelf: false }, 'user-1')).toBeNull()
  })
})
