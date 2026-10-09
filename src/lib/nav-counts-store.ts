// W20-D: live sidebar pending counts (Approvals / Certifications) — a
// framework-agnostic external store (the image-viewer-store idiom), so the TWO
// Sidebar instances (rail + phone drawer, both mounted while the drawer is open)
// share ONE value and refetches happen in ONE place (NavCountsSync). null = not
// loaded: the Sidebar falls back to the layout's SSR seed until the first fetch
// lands (the Chat badge's seed rule), so hydration never flashes a wrong count.
export type NavCounts = { approvals: number; trainingRequests: number }

let current: NavCounts | null = null
let seq = 0
const listeners = new Set<() => void>()

export function navCountsSnapshot(): NavCounts | null {
  return current
}

export function subscribeNavCounts(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

// Refetch the counts. Overlapping calls resolve LAST-ISSUED-wins (a sequence
// guard), so a slow early response can never overwrite a fresher one; a failed,
// thrown or malformed response keeps the previous value (the next trigger retries).
export async function refreshNavCounts(fetchImpl: typeof fetch = fetch): Promise<void> {
  const mine = ++seq
  try {
    const r = await fetchImpl('/api/nav-counts')
    if (!r.ok) return
    const d = (await r.json()) as Record<string, unknown>
    if (mine !== seq || !isCount(d.approvals) || !isCount(d.trainingRequests)) return
    current = { approvals: d.approvals, trainingRequests: d.trainingRequests }
    for (const fn of listeners) fn()
  } catch { /* transient — the next trigger retries */ }
}

// Forget the counts when the app shell unmounts. Sign-out is a client navigation
// (router.push), so this module state outlives the layout; without the clear,
// the NEXT user to sign in on this tab would paint the previous user's counts
// until the first refetch landed. Bumping seq also discards any response still
// in flight from the previous session.
export function clearNavCounts(): void {
  seq++
  if (current === null) return
  current = null
  for (const fn of listeners) fn()
}

export function _resetNavCountsForTests(): void {
  current = null
  seq = 0
  listeners.clear()
}
