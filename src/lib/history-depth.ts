// Depth algebra behind the top-bar Back control (`src/components/back-button.tsx`).
//
// The control must never navigate OUT of the app, so it is shown only when at least one
// in-app history entry sits behind the current one. `window.history.length` cannot answer
// that (it counts entries that existed before the app was ever loaded) and neither can a
// bare counter (it only climbs, so after walking back to the first entry it would still
// offer a Back that exits). The depth is therefore stamped onto each history ENTRY, and
// this module holds the three transitions that maintain it. `@/lib/history-depth-store` owns
// the `window.history` plumbing and the current value; everything here is pure.

export const DEPTH_KEY = 'labhubDepth'

export type DepthState = {
  depth: number
  /** False only until the entry this document loaded on has been accounted for. */
  seeded: boolean
}

/**
 * How the current entry came about:
 * - `push`    a NEW entry — one deeper than the entry it was pushed from.
 * - `replace` the current entry is overwritten in place (`router.replace`,
 *             `router.refresh`, a query-only filter update, or Next replaying a
 *             restored entry) — no entry is created, so the depth does not move.
 * - `restore` the store (`historyDepth.sync()` / `adopt()`) reading whichever entry
 *             is now current — the entry's own stamp is trusted.
 */
export type NavKind = 'push' | 'replace' | 'restore'

export type DepthResult = DepthState & {
  /** True when the entry must be (re-)stamped with `depth`. */
  write: boolean
}

/** The depth stamped on a history state, or null when it carries no usable stamp. */
export function readDepth(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null
  const v = (state as Record<string, unknown>)[DEPTH_KEY]
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null
}

/**
 * Add or overwrite the stamp, spread-preserving every key already on the state — Next
 * keys `__NA` and `__PRIVATE_NEXTJS_INTERNALS_TREE` off it and breaks if they are
 * dropped. A non-object state cannot carry a stamp and is passed through untouched.
 */
export function stampDepth(state: unknown, depth: number): unknown {
  if (state !== null && state !== undefined && typeof state !== 'object') return state
  return { ...(state ?? {}), [DEPTH_KEY]: depth }
}

export function nextDepth(prev: DepthState, kind: NavKind, state: unknown): DepthResult {
  // A push always creates a new, deeper entry — any stamp riding along on the pushed
  // state belongs to the entry it was copied from, so it is deliberately ignored.
  if (kind === 'push') return { depth: prev.depth + 1, seeded: true, write: true }

  const stamped = readDepth(state)
  // A replace overwrites the current entry. Next writes its bare state (no spread) for
  // `router.replace`/`router.refresh`/server actions, which strips the stamp — the depth
  // must survive that. On a traversal Next spreads the entry the browser restored, so the
  // stamp IS present and wins: that is how back/forward move the depth.
  if (kind === 'replace') return { depth: stamped ?? prev.depth, seeded: true, write: true }

  // 'restore': trust the entry's own stamp when it has one.
  if (stamped !== null) return { depth: stamped, seeded: true, write: false }
  // Unstamped: the entry this document loaded on is depth 0 — a cold deep link, a PWA
  // launch, or an `sw.js` notification navigation shows no control at all. Once seeded,
  // an unstamped entry can only be one the browser created without a pushState call (an
  // in-page #hash anchor), which is one deeper.
  return { depth: prev.seeded ? prev.depth + 1 : 0, seeded: true, write: true }
}
