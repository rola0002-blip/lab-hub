// In-memory last-activity map backing the push-idle gate (2026-09-01
// notifications design). Clients report activity via POST /api/activity
// (throttled client-side) and the typing route; fanout reads isActive() to
// decide phone push. Single-instance by design — the same assumption the
// SSE registry in events.ts makes; a restart resets the map (worst case one
// extra push round, exactly like presence today).
const g = globalThis as unknown as { labhubActivity?: Map<string, number> }
g.labhubActivity ??= new Map()

// Push fires only when the user has NOT been active for this long.
export const ACTIVITY_IDLE_MS = 120_000

export function noteActivity(userId: string, at: number = Date.now()): void {
  g.labhubActivity!.set(userId, at)
}

export function isActive(userId: string, now: number = Date.now()): boolean {
  const at = g.labhubActivity!.get(userId)
  return at !== undefined && now - at < ACTIVITY_IDLE_MS
}

export function _resetActivityForTests(): void {
  g.labhubActivity!.clear()
}
