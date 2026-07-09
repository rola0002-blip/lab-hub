import 'server-only'

// Stub — Task 7 replaces this with real VAPID Web Push.
export async function sendPush(_userId: string, _payload: { title: string; body: string; url: string }): Promise<void> {}
export function pushEnabled(): boolean { return false }
