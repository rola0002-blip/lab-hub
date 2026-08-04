import { nextDepth, readDepth, stampDepth, type DepthState, type NavKind } from '@/lib/history-depth'

// Framework-agnostic external store holding "how many in-app history entries sit behind the
// current one" — the single source of truth for the top-bar Back control
// (src/components/back-button.tsx), which binds it with useSyncExternalStore (the
// toast-store.ts / theme-toggle.tsx idiom). Kept out of React so the wiring is unit-testable
// against a fake history, and so visibility can never desync from the real history: the
// depth changes when the HISTORY changes, not when a route re-renders.
//
// The transitions themselves live in `@/lib/history-depth`; this module only decides which
// transition each event feeds.

export type HistoryLike = Pick<History, 'state' | 'pushState' | 'replaceState'>

export type HistoryDepthStore = {
  subscribe(listener: () => void): () => void
  /** True when at least one in-app entry sits behind the current one. */
  getSnapshot(): boolean
  /** The server (and hydration) answer is always "nothing behind": history is unreadable there. */
  getServerSnapshot(): boolean
  depth(): number
  /** Wrap the history mutators so every entry carries a depth. Idempotent, never undone. */
  install(h: HistoryLike): void
  /** Account for whichever entry is current, stamping it when it has no stamp yet. */
  sync(h: HistoryLike): void
  /** Adopt the depth of an entry a traversal restored, when it carries one. */
  adopt(state: unknown): void
}

/**
 * `schedule` defers the subscriber notification off the current task. This is REQUIRED in
 * the browser and is not a micro-optimisation: Next writes history from `HistoryUpdater`,
 * a `useInsertionEffect`, so a synchronous notify schedules a React update from inside the
 * insertion-effect phase — React logs "useInsertionEffect must not schedule updates."
 * (observed three times per journey before this was added). Deferring costs nothing: the
 * depth itself moves synchronously, `getSnapshot` always reports the live value, and the
 * re-render still lands before paint. Tests inject a synchronous scheduler.
 */
export function createHistoryDepthStore(schedule: (fn: () => void) => void = queueMicrotask): HistoryDepthStore {
  // `seeded` distinguishes the entry the document loaded on (depth 0) from entries created
  // by in-app navigation. A genuine page load re-evaluates the module, which is exactly when
  // both must reset.
  let current: DepthState = { depth: 0, seeded: false }
  let installed = false
  let pending = false
  const listeners = new Set<() => void>()

  function advance(kind: NavKind, state: unknown) {
    const before = current.depth
    const r = nextDepth(current, kind, state)
    current = { depth: r.depth, seeded: r.seeded }
    // The snapshot is a boolean, so a no-op notify would be harmless — but only emitting on
    // a real move keeps `router.refresh()` storms off React's scheduler entirely. Repeated
    // moves before the flush coalesce into one notification.
    if (r.depth !== before && !pending) {
      pending = true
      schedule(() => { pending = false; for (const l of listeners) l() })
    }
    return r
  }

  function install(h: HistoryLike): void {
    if (installed) return
    installed = true
    // Bound BEFORE assignment, so these stay the underlying implementations. Next patches
    // the same two methods in an app-router effect; child effects run first, so Next captures
    // these wrappers as its own "originals" and delegates to them (its patch short-circuits
    // on `__NA`, which every Next-written state carries). The reverse order composes too —
    // either way the state is stamped exactly once.
    const push = h.pushState.bind(h)
    const replace = h.replaceState.bind(h)
    h.pushState = (data: unknown, unused: string, url?: string | URL | null) =>
      push(stampDepth(data, advance('push', data).depth), unused, url)
    h.replaceState = (data: unknown, unused: string, url?: string | URL | null) =>
      replace(stampDepth(data, advance('replace', data).depth), unused, url)
  }

  function sync(h: HistoryLike): void {
    const st = h.state
    const r = advance('restore', st)
    // Spread-preserve Next's own history state (it keys popstate off it); never replace it
    // with a bare object.
    if (r.write) h.replaceState(stampDepth(st, r.depth), '')
  }

  function adopt(state: unknown): void {
    // Only a stamped entry moves the depth. An unstamped one on a traversal is an entry the
    // browser created without a pushState call (a plain in-page #hash anchor); guessing it
    // deeper would be guessing in the one direction that can offer a Back out of the app.
    if (readDepth(state) !== null) advance('restore', state)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => current.depth > 0,
    getServerSnapshot: () => false,
    depth: () => current.depth,
    install,
    sync,
    adopt,
  }
}

// App-wide singleton: one document, one history, one depth.
export const historyDepth = createHistoryDepthStore()
