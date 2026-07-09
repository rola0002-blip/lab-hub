// In-memory sliding window: 30 sends / 60s per user. Single-process deployment;
// a multi-instance future would move this to the database or a shared store.
const WINDOW_MS = 60_000
const LIMIT = 30
const sends = new Map<string, number[]>()

export function checkRate(userId: string, now: number = Date.now()): boolean {
  const list = (sends.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= LIMIT) {
    sends.set(userId, list)
    return false
  }
  list.push(now)
  sends.set(userId, list)
  return true
}

export function resetRate(): void {
  sends.clear()
}
