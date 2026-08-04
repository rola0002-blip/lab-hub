import { describe, it, expect } from 'vitest'
import { DEPTH_KEY, nextDepth, readDepth, stampDepth, type DepthState } from '@/lib/history-depth'

// The depth algebra behind the top-bar Back control. The normative rule (spec §5.1) is
// that the control may never navigate OUT of the app, so every transition below is
// written from the question "how many in-app entries are behind this one?".

// Next's own history state, as written by app-router's HistoryUpdater.
const NEXT_STATE = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: ['', {}] } }

describe('readDepth', () => {
  it('returns null for anything that is not a stamped object', () => {
    expect(readDepth(null)).toBeNull()
    expect(readDepth(undefined)).toBeNull()
    expect(readDepth('deep')).toBeNull()
    expect(readDepth(3)).toBeNull()
    expect(readDepth({})).toBeNull()
    expect(readDepth(NEXT_STATE)).toBeNull()
  })
  it('reads a stamped depth, including 0', () => {
    expect(readDepth({ [DEPTH_KEY]: 0 })).toBe(0)
    expect(readDepth({ ...NEXT_STATE, [DEPTH_KEY]: 4 })).toBe(4)
  })
  it('rejects a malformed stamp rather than trusting it', () => {
    expect(readDepth({ [DEPTH_KEY]: '2' })).toBeNull()
    expect(readDepth({ [DEPTH_KEY]: -1 })).toBeNull()
    expect(readDepth({ [DEPTH_KEY]: 1.5 })).toBeNull()
    expect(readDepth({ [DEPTH_KEY]: NaN })).toBeNull()
  })
})

describe('stampDepth', () => {
  it("preserves Next's own history keys — clobbering them breaks the App Router", () => {
    const out = stampDepth(NEXT_STATE, 2) as Record<string, unknown>
    expect(out.__NA).toBe(true)
    expect(out.__PRIVATE_NEXTJS_INTERNALS_TREE).toBe(NEXT_STATE.__PRIVATE_NEXTJS_INTERNALS_TREE)
    expect(out[DEPTH_KEY]).toBe(2)
  })
  it('stamps a null/undefined state (the first entry of a fresh document)', () => {
    expect(stampDepth(null, 0)).toEqual({ [DEPTH_KEY]: 0 })
    expect(stampDepth(undefined, 1)).toEqual({ [DEPTH_KEY]: 1 })
  })
  it('overwrites a previous stamp', () => {
    expect(readDepth(stampDepth({ [DEPTH_KEY]: 7 }, 1))).toBe(1)
  })
  it('passes a non-object state through untouched (it cannot carry a stamp)', () => {
    expect(stampDepth('opaque', 1)).toBe('opaque')
  })
})

describe('nextDepth', () => {
  const seeded = (depth: number): DepthState => ({ depth, seeded: true })

  it('a cold deep link / PWA launch / sw.js navigation is depth 0 and must be stamped', () => {
    expect(nextDepth({ depth: 0, seeded: false }, 'restore', null)).toEqual({ depth: 0, seeded: true, write: true })
  })
  it('restoring an entry adopts its stamp and writes nothing', () => {
    expect(nextDepth(seeded(3), 'restore', { ...NEXT_STATE, [DEPTH_KEY]: 5 }))
      .toEqual({ depth: 5, seeded: true, write: false })
    // Walking BACK to a shallower entry must lower the depth — a counter that only
    // climbs would keep offering a Back that leaves the app.
    expect(nextDepth(seeded(3), 'restore', { ...NEXT_STATE, [DEPTH_KEY]: 0 }))
      .toEqual({ depth: 0, seeded: true, write: false })
  })
  it('restoring an UNstamped entry after seeding falls back to one deeper', () => {
    // Defensive: only reachable for an entry the browser created without a
    // pushState call (a plain in-page #hash anchor).
    expect(nextDepth(seeded(1), 'restore', NEXT_STATE)).toEqual({ depth: 2, seeded: true, write: true })
  })

  it('a push is always one deeper, whatever state it carries', () => {
    expect(nextDepth(seeded(0), 'push', NEXT_STATE)).toEqual({ depth: 1, seeded: true, write: true })
    expect(nextDepth({ depth: 0, seeded: false }, 'push', null)).toEqual({ depth: 1, seeded: true, write: true })
    // A stale stamp on the pushed state never wins: a push creates a NEW entry.
    expect(nextDepth(seeded(2), 'push', { ...NEXT_STATE, [DEPTH_KEY]: 0 }))
      .toEqual({ depth: 3, seeded: true, write: true })
  })

  it('a replace keeps the depth of the entry it overwrites', () => {
    // router.replace() and router.refresh() both re-write the current entry with
    // Next's bare state (preserveCustomHistoryState: false), stamp stripped. No new
    // entry exists, so the depth must not move.
    expect(nextDepth(seeded(2), 'replace', NEXT_STATE)).toEqual({ depth: 2, seeded: true, write: true })
    expect(nextDepth({ depth: 0, seeded: false }, 'replace', NEXT_STATE)).toEqual({ depth: 0, seeded: true, write: true })
  })
  it('a replace that carries a stamp adopts it (the traversal path)', () => {
    // On back/forward Next re-writes the restored entry with preserveCustomHistoryState:
    // true, spreading the stamp the browser just restored.
    expect(nextDepth(seeded(4), 'replace', { ...NEXT_STATE, [DEPTH_KEY]: 1 }))
      .toEqual({ depth: 1, seeded: true, write: true })
  })
})

describe('journeys', () => {
  // Mirrors the component's plumbing: one running DepthState, driven by the same three
  // transitions the instrumented history mutators and the effect feed it.
  function journey() {
    let s: DepthState = { depth: 0, seeded: false }
    const stack: unknown[] = []
    return {
      get depth() { return s.depth },
      get shown() { return s.depth > 0 },
      /** A history entry stamped by the instrumented mutator, then read by the effect. */
      step(kind: 'push' | 'replace' | 'restore', state: unknown) {
        const r = nextDepth(s, kind, state)
        s = { depth: r.depth, seeded: r.seeded }
        if (r.write) state = stampDepth(state, r.depth)
        if (kind === 'push') stack.push(state)
        else stack[Math.max(stack.length - 1, 0)] = state
        return state
      },
      /** Simulate a browser traversal: Next replays the restored entry's state. */
      back(entry: unknown) { this.step('replace', entry); this.step('restore', entry) },
      entries: stack,
    }
  }

  it('cold deep link → push → back → forward', () => {
    const j = journey()
    const load = j.step('restore', null)             // cold load of /issues/LAB-1
    expect(j.shown).toBe(false)                      // nothing behind: no control
    j.step('push', NEXT_STATE)                       // click through to /projects
    const deep = j.step('restore', { ...NEXT_STATE, [DEPTH_KEY]: 1 })
    expect(j.depth).toBe(1)
    expect(j.shown).toBe(true)
    j.back(load)                                     // Back → the load entry
    expect(j.depth).toBe(0)
    expect(j.shown).toBe(false)                      // the load entry's stamp is 0
    j.back(deep)                                     // Forward again
    expect(j.shown).toBe(true)
  })

  it('a post-delete router.replace on the load entry cannot produce an exiting Back', () => {
    // T4: deleting an issue navigates with router.replace('/issues'). On a cold deep
    // link there is NO in-app entry behind it, so the control must stay hidden.
    const j = journey()
    j.step('restore', null)
    j.step('replace', NEXT_STATE)                    // router.replace('/issues')
    j.step('restore', j.entries[0] ?? null)
    expect(j.depth).toBe(0)
    expect(j.shown).toBe(false)
  })

  it('a post-delete router.replace deeper in keeps the depth of the entry it replaced', () => {
    const j = journey()
    const load = j.step('restore', null)             // /issues
    j.step('push', NEXT_STATE)                       // open /issues/LAB-1
    j.step('restore', { ...NEXT_STATE, [DEPTH_KEY]: 1 })
    expect(j.depth).toBe(1)
    const replaced = j.step('replace', NEXT_STATE)   // delete → router.replace('/issues')
    j.step('restore', replaced)
    expect(j.depth).toBe(1)                          // NOT 2 — no entry was created
    j.back(load)                                     // Back skips the deleted route
    expect(j.depth).toBe(0)
    expect(j.shown).toBe(false)
  })

  it('router.refresh() on the current entry never deepens history', () => {
    const j = journey()
    j.step('restore', null)
    j.step('push', NEXT_STATE)
    j.step('restore', { ...NEXT_STATE, [DEPTH_KEY]: 1 })
    for (let i = 0; i < 5; i++) j.step('replace', NEXT_STATE) // five refreshes / filter replaces
    expect(j.depth).toBe(1)
  })

  it('a reload mid-session restores the depth from the entry', () => {
    // A genuine page load re-evaluates the module (seeded false again), but the
    // browser hands back the entry's own state — stamp included.
    const fresh: DepthState = { depth: 0, seeded: false }
    expect(nextDepth(fresh, 'restore', { ...NEXT_STATE, [DEPTH_KEY]: 2 }))
      .toEqual({ depth: 2, seeded: true, write: false })
  })
})
