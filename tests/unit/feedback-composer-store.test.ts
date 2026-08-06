import { describe, it, expect } from 'vitest'
import { openFeedbackComposer, closeFeedbackComposer, subscribeFeedbackComposer, getFeedbackComposer } from '@/lib/feedback-composer-store'

describe('feedback-composer-store', () => {
  it('starts closed with an empty pagePath', () => {
    expect(getFeedbackComposer()).toEqual({ open: false, pagePath: '' })
  })

  it('opens with the caller-supplied path, notifies subscribers, closes clean, and drops unsubscribed listeners', () => {
    const seen: { open: boolean; pagePath: string }[] = []
    const unsub = subscribeFeedbackComposer(() => seen.push(getFeedbackComposer()))

    openFeedbackComposer('/booking?week=2026-08-10')
    expect(getFeedbackComposer()).toEqual({ open: true, pagePath: '/booking?week=2026-08-10' })

    closeFeedbackComposer()
    expect(getFeedbackComposer()).toEqual({ open: false, pagePath: '' })
    expect(seen).toEqual([
      { open: true, pagePath: '/booking?week=2026-08-10' },
      { open: false, pagePath: '' },
    ])

    unsub()
    openFeedbackComposer('/issues')
    expect(seen).toHaveLength(2) // unsubscribed listener no longer called
    expect(getFeedbackComposer()).toEqual({ open: true, pagePath: '/issues' }) // state still advances
    closeFeedbackComposer() // leave module state clean for other tests
  })

  it('re-opening replaces the captured path', () => {
    openFeedbackComposer('/files')
    openFeedbackComposer('/projects')
    expect(getFeedbackComposer()).toEqual({ open: true, pagePath: '/projects' })
    closeFeedbackComposer()
  })

  it('returns a stable snapshot reference between transitions (useSyncExternalStore contract)', () => {
    openFeedbackComposer('/dashboard')
    expect(getFeedbackComposer()).toBe(getFeedbackComposer())
    closeFeedbackComposer()
  })
})
