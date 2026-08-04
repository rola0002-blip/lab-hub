import { describe, it, expect, vi } from 'vitest'
import { createHistoryDepthStore, type HistoryLike } from '@/lib/history-depth-store'
import { DEPTH_KEY, readDepth } from '@/lib/history-depth'

// The WIRING around the (separately tested) depth algebra: which transition each history
// mutator maps to, that installing is idempotent, that layering Next's own patch over ours
// (in either order) stamps exactly once, and that the subscription fires when — and only
// when — the answer to "is anything behind us?" can have changed.

// Next's own history state, as written by app-router's HistoryUpdater.
const NEXT = () => ({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ['', {}] } })

function fakeHistory(initial: unknown = null) {
  return {
    state: initial,
    pushed: [] as unknown[],
    replaced: [] as unknown[],
    pushState(data: unknown, _unused: string, _url?: string | URL | null) { this.state = data; this.pushed.push(data) },
    replaceState(data: unknown, _unused: string, _url?: string | URL | null) { this.state = data; this.replaced.push(data) },
  }
}

/** Mimic Next's patch of the same two methods: short-circuit to the captured original
 *  whenever the state carries `__NA`, otherwise copy its internal keys on first. */
function layerNextPatch(h: HistoryLike) {
  const push = h.pushState.bind(h)
  const replace = h.replaceState.bind(h)
  h.pushState = (data: unknown, unused: string, url?: string | URL | null) =>
    push((data as { __NA?: boolean })?.__NA ? data : { ...(data ?? {}), ...NEXT() }, unused, url)
  h.replaceState = (data: unknown, unused: string, url?: string | URL | null) =>
    replace((data as { __NA?: boolean })?.__NA ? data : { ...(data ?? {}), ...NEXT() }, unused, url)
}

describe('history depth store — installation', () => {
  it('is idempotent: installing twice does not wrap twice', () => {
    const h = fakeHistory()
    const s = createHistoryDepthStore()
    s.install(h)
    s.install(h)
    h.pushState(NEXT(), '', '/projects')
    expect(s.depth()).toBe(1)                     // 2 would mean the wrapper wrapped itself
    expect(readDepth(h.state)).toBe(1)
  })

  it('maps pushState → push (one deeper) and keeps Next\'s own keys', () => {
    const h = fakeHistory()
    const s = createHistoryDepthStore()
    s.install(h)
    h.pushState(NEXT(), '', '/a')
    h.pushState(NEXT(), '', '/b')
    expect(s.depth()).toBe(2)
    const st = h.state as Record<string, unknown>
    expect(st.__NA).toBe(true)
    expect(st.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual({ tree: ['', {}] })
    expect(st[DEPTH_KEY]).toBe(2)
  })

  it('maps replaceState → replace: the depth never moves, the stamp is re-injected', () => {
    const h = fakeHistory()
    const s = createHistoryDepthStore()
    s.install(h)
    h.pushState(NEXT(), '', '/issues/LAB-1')
    // router.replace / router.refresh / a query-only filter update: Next writes its BARE
    // state, stamp stripped. No entry is created, so the depth must hold.
    h.replaceState(NEXT(), '', '/issues')
    h.replaceState(NEXT(), '', '/issues')
    expect(s.depth()).toBe(1)
    expect(readDepth(h.state)).toBe(1)
  })

  it('adopts the stamp a traversal restores (Next spreads it on the replace)', () => {
    const h = fakeHistory()
    const s = createHistoryDepthStore()
    s.install(h)
    h.pushState(NEXT(), '', '/a')
    h.pushState(NEXT(), '', '/b')
    expect(s.depth()).toBe(2)
    h.replaceState({ ...NEXT(), [DEPTH_KEY]: 0 }, '', '/')   // back to the load entry
    expect(s.depth()).toBe(0)
    expect(s.getSnapshot()).toBe(false)
  })

  it('stamps exactly once when Next\'s patch is layered ON TOP of ours', () => {
    const h = fakeHistory()
    const s = createHistoryDepthStore()
    s.install(h)
    layerNextPatch(h)                                        // Next captures OUR wrapper
    h.pushState(NEXT(), '', '/a')                            // __NA → short-circuits to ours
    expect(s.depth()).toBe(1)
    expect(readDepth(h.state)).toBe(1)
    h.pushState({ custom: true }, '', '/b')                  // app-code push, no __NA
    expect(s.depth()).toBe(2)
    expect(readDepth(h.state)).toBe(2)
    expect((h.state as { custom?: boolean }).custom).toBe(true)
  })

  it('stamps exactly once when ours is layered on top of Next\'s patch', () => {
    const h = fakeHistory()
    const s = createHistoryDepthStore()
    layerNextPatch(h)
    s.install(h)
    h.pushState(NEXT(), '', '/a')
    expect(s.depth()).toBe(1)
    expect(readDepth(h.state)).toBe(1)
  })
})

describe('history depth store — sync and adopt', () => {
  it('seeds an unstamped load entry at 0 and stamps it', () => {
    const h = fakeHistory(NEXT())
    const s = createHistoryDepthStore()
    s.install(h)
    s.sync(h)
    expect(s.depth()).toBe(0)
    expect(s.getSnapshot()).toBe(false)
    expect(readDepth(h.state)).toBe(0)
    expect(h.replaced).toHaveLength(1)
  })

  it('adopts an already-stamped entry without rewriting it (reload mid-session)', () => {
    const h = fakeHistory({ ...NEXT(), [DEPTH_KEY]: 3 })
    const s = createHistoryDepthStore()
    s.install(h)
    s.sync(h)
    expect(s.depth()).toBe(3)
    expect(s.getSnapshot()).toBe(true)
    expect(h.replaced).toHaveLength(0)             // nothing to write
  })

  it('adopt() takes a stamped popstate state and ignores an unstamped one', () => {
    const s = createHistoryDepthStore()
    const h = fakeHistory()
    s.install(h)
    h.pushState(NEXT(), '', '/a')
    s.adopt({ ...NEXT(), [DEPTH_KEY]: 0 })
    expect(s.depth()).toBe(0)
    // An entry the browser made with no pushState call (a plain in-page #hash anchor)
    // carries no stamp: leave the depth alone rather than guessing it deeper.
    s.adopt(NEXT())
    expect(s.depth()).toBe(0)
    s.adopt(null)
    expect(s.depth()).toBe(0)
  })
})

describe('history depth store — subscription', () => {
  // Notifications are deferred off the current task in the browser (React forbids scheduling
  // an update from Next's useInsertionEffect, which is where history is written). Inject a
  // synchronous scheduler so the assertions stay direct; the default is asserted below.
  const sync = () => createHistoryDepthStore((fn) => fn())

  it('defers the notification off the current task by default', async () => {
    const h = fakeHistory()
    const s = createHistoryDepthStore()
    s.install(h)
    const seen = vi.fn()
    s.subscribe(seen)
    h.pushState(NEXT(), '', '/a')
    expect(s.depth()).toBe(1)                      // the depth moves synchronously…
    expect(seen).not.toHaveBeenCalled()            // …the notification does not
    await Promise.resolve()
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('coalesces several moves before the flush into one notification', async () => {
    const h = fakeHistory()
    const s = createHistoryDepthStore()
    s.install(h)
    const seen = vi.fn()
    s.subscribe(seen)
    h.pushState(NEXT(), '', '/a')
    h.pushState(NEXT(), '', '/b')
    h.pushState(NEXT(), '', '/c')
    await Promise.resolve()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(s.depth()).toBe(3)
  })

  it('notifies on a depth change, stays quiet otherwise, and unsubscribes', () => {
    const h = fakeHistory()
    const s = sync()
    s.install(h)
    const seen = vi.fn()
    const off = s.subscribe(seen)

    h.pushState(NEXT(), '', '/a')                  // 0 → 1
    expect(seen).toHaveBeenCalledTimes(1)
    h.replaceState(NEXT(), '', '/a?x=1')           // depth unchanged → no notify
    h.replaceState(NEXT(), '', '/a?x=2')
    expect(seen).toHaveBeenCalledTimes(1)
    h.replaceState({ ...NEXT(), [DEPTH_KEY]: 0 }, '', '/')  // 1 → 0
    expect(seen).toHaveBeenCalledTimes(2)

    off()
    h.pushState(NEXT(), '', '/b')
    expect(seen).toHaveBeenCalledTimes(2)
    expect(s.depth()).toBe(1)                      // still tracking, just not notifying
  })

  it('the server snapshot is always false, so SSR and first paint render nothing', () => {
    const h = fakeHistory()
    const s = sync()
    s.install(h)
    h.pushState(NEXT(), '', '/a')
    expect(s.getSnapshot()).toBe(true)
    expect(s.getServerSnapshot()).toBe(false)
  })

  it('subscribe/getSnapshot survive being passed unbound (useSyncExternalStore does)', () => {
    const h = fakeHistory()
    const s = sync()
    const { subscribe, getSnapshot } = s
    s.install(h)
    const seen = vi.fn()
    subscribe(seen)
    h.pushState(NEXT(), '', '/a')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(getSnapshot()).toBe(true)
  })
})

describe('history depth store — the wired journey', () => {
  it('cold deep link → same-pathname push → back → post-delete replace', () => {
    const h = fakeHistory(NEXT())
    const s = createHistoryDepthStore()
    s.install(h)
    s.sync(h)                                       // cold load of /chat/c1
    expect(s.getSnapshot()).toBe(false)

    // The finding-1 case: a push that changes ONLY the query (search-box.tsx deep-links
    // to /chat/<id>?msg=<n>). The control must appear even though the pathname is equal.
    const loadEntry = h.state
    h.pushState(NEXT(), '', '/chat/c1?msg=m9')
    expect(s.getSnapshot()).toBe(true)
    expect(s.depth()).toBe(1)

    // ...and disappear again on the way back, same pathname.
    s.adopt(loadEntry)
    h.replaceState({ ...(loadEntry as object), ...NEXT() }, '', '/chat/c1')
    expect(s.depth()).toBe(0)
    expect(s.getSnapshot()).toBe(false)

    // A post-delete router.replace on the load entry creates no entry: still nothing behind.
    h.replaceState(NEXT(), '', '/issues')
    expect(s.depth()).toBe(0)
    expect(s.getSnapshot()).toBe(false)
  })
})
