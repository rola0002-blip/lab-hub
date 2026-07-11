import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createToastStore, toast, toastStore } from '@/lib/toast-store'

describe('toast store', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('adds a toast and reflects it in the snapshot', () => {
    const store = createToastStore()
    const id = store.add('Saved')
    const snap = store.getSnapshot()
    expect(snap).toHaveLength(1)
    expect(snap[0]).toMatchObject({ id, message: 'Saved' })
  })

  it('gives each toast a distinct id and preserves insertion order', () => {
    const store = createToastStore()
    const a = store.add('first')
    const b = store.add('second')
    expect(a).not.toBe(b)
    expect(store.getSnapshot().map((t) => t.message)).toEqual(['first', 'second'])
  })

  it('notifies subscribers on add and on dismiss', () => {
    const store = createToastStore()
    const listener = vi.fn()
    const unsub = store.subscribe(listener)
    const id = store.add('hi')
    expect(listener).toHaveBeenCalledTimes(1)
    store.dismiss(id)
    expect(listener).toHaveBeenCalledTimes(2)
    unsub()
    store.add('after unsubscribe')
    expect(listener).toHaveBeenCalledTimes(2) // no further notifications
  })

  it('auto-dismisses after the default timeout (~3s)', () => {
    const store = createToastStore()
    store.add('temporary')
    expect(store.getSnapshot()).toHaveLength(1)
    vi.advanceTimersByTime(2999)
    expect(store.getSnapshot()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(store.getSnapshot()).toHaveLength(0)
  })

  it('honours a per-toast duration override', () => {
    const store = createToastStore(3000)
    store.add('quick', { duration: 500 })
    vi.advanceTimersByTime(500)
    expect(store.getSnapshot()).toHaveLength(0)
  })

  it('keeps a toast forever when duration <= 0', () => {
    const store = createToastStore()
    store.add('sticky', { duration: 0 })
    vi.advanceTimersByTime(60_000)
    expect(store.getSnapshot()).toHaveLength(1)
  })

  it('dismiss removes the toast immediately and cancels its pending timer', () => {
    const store = createToastStore()
    const id = store.add('gone soon')
    store.dismiss(id)
    expect(store.getSnapshot()).toHaveLength(0)
    const ref = store.getSnapshot()
    vi.advanceTimersByTime(5000) // the auto-dismiss timer must not fire on an already-removed toast
    expect(store.getSnapshot()).toBe(ref) // no further mutation
  })

  it('dismissing an unknown id is a no-op that does not notify or change the snapshot', () => {
    const store = createToastStore()
    store.add('keep me')
    const before = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)
    store.dismiss('does-not-exist')
    expect(store.getSnapshot()).toBe(before) // same reference, untouched
    expect(listener).not.toHaveBeenCalled()
  })

  it('carries an optional Retry action', () => {
    const store = createToastStore()
    const onClick = vi.fn()
    store.add('Failed', { action: { label: 'Retry', onClick } })
    const [t] = store.getSnapshot()
    expect(t.action?.label).toBe('Retry')
    t.action?.onClick()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('returns a stable snapshot reference until the state changes', () => {
    const store = createToastStore()
    const empty = store.getSnapshot()
    expect(store.getSnapshot()).toBe(empty)
    store.add('changes it')
    expect(store.getSnapshot()).not.toBe(empty)
  })

  it('exposes a global toast() bound to the singleton store', () => {
    const id = toast('global', { duration: 0 })
    expect(toastStore.getSnapshot().some((t) => t.id === id)).toBe(true)
    toastStore.dismiss(id) // clean up shared singleton state
  })
})
