// In-memory sliding window: 5 feedback submissions / 600 s per user, mirroring
// chat's limiter (src/features/chat/rate-limit.ts). Single-process deployment;
// a multi-instance future would move this to the database or a shared store.
// Module constants by design — deliberately not org settings (the stale.ts precedent).
export const FEEDBACK_RATE_MAX = 5
export const FEEDBACK_RATE_WINDOW_MS = 600_000
const submissions = new Map<string, number[]>()

export function checkFeedbackRate(userId: string, now: number = Date.now()): boolean {
  const list = (submissions.get(userId) ?? []).filter((t) => now - t < FEEDBACK_RATE_WINDOW_MS)
  if (list.length >= FEEDBACK_RATE_MAX) {
    submissions.set(userId, list)
    return false
  }
  list.push(now)
  submissions.set(userId, list)
  return true
}

export function resetFeedbackRate(): void {
  submissions.clear()
}
