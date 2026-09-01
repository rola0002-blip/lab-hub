// Server-side push burst squelch: at most one web push per (user,
// conversation) per window. The service worker's tag collapse already
// coalesces the VISIBLE notification; this stops endpoint churn when a
// channel bursts. Allowing a push records the hit (reserves the window);
// dropped hits re-record nothing so they never extend the window.
const g = globalThis as unknown as { labhubPushSquelch?: Map<string, number> }
g.labhubPushSquelch ??= new Map()

export const SQUELCH_WINDOW_MS = 60_000
export const MAX_ENTRIES = 50_000 // cheap bounded-memory guard for long uptimes

export function tryReservePush(userId: string, conversationId: string, now: number = Date.now()): boolean {
  const map = g.labhubPushSquelch!
  const key = `${userId}:${conversationId}`
  const last = map.get(key)
  if (last !== undefined && now - last < SQUELCH_WINDOW_MS) return false
  if (map.size > MAX_ENTRIES) {
    for (const [k, t] of map) if (now - t >= SQUELCH_WINDOW_MS) map.delete(k)
  }
  map.set(key, now)
  return true
}

export function _resetSquelchForTests(): void {
  g.labhubPushSquelch!.clear()
}
