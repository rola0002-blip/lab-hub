import { describe, it, expect } from 'vitest'
import { openIssueComposer, closeIssueComposer, subscribeIssueComposer, getIssueComposer } from '@/lib/issue-composer-store'

describe('issue-composer-store', () => {
  it('opens with prefill, notifies subscribers, closes clean, and drops unsubscribed listeners', () => {
    const seen: boolean[] = []
    const unsub = subscribeIssueComposer(() => seen.push(getIssueComposer().open))
    openIssueComposer({ title: 'From chat', projectId: 'p1' })
    expect(getIssueComposer()).toEqual({ open: true, prefill: { title: 'From chat', projectId: 'p1' } })
    closeIssueComposer()
    expect(getIssueComposer()).toEqual({ open: false, prefill: {} })
    expect(seen).toEqual([true, false])
    unsub()
    openIssueComposer()
    expect(seen).toEqual([true, false]) // unsubscribed listener no longer called
    closeIssueComposer() // leave module state clean for other tests
  })
})
