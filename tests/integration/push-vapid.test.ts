import { describe, it, expect, beforeEach, vi } from 'vitest'

// Regression guard (SP7 §6.3): once the compose passthrough delivers VAPID to the container,
// pushEnabled() must be true and /api/push/vapid must return the real key for a signed-in
// user. We mock @/lib/env (VAPID present) + @/lib/session (a user); no DB is touched. Both
// @/lib/env and push.ts's './env' resolve to the same file, so one mock covers both.
const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))
vi.mock('@/lib/env', () => ({
  env: { VAPID_PUBLIC_KEY: 'BTestPublicKey_url_safe', VAPID_PRIVATE_KEY: 'test-private-key' },
}))

import { GET as vapid } from '@/app/api/push/vapid/route'
import { pushEnabled } from '@/lib/push'

describe('web push activation regression (VAPID passthrough)', () => {
  beforeEach(() => { mockUser.current = null })

  it('pushEnabled() is true when both VAPID vars are set', () => {
    expect(pushEnabled()).toBe(true)
  })

  it('GET /api/push/vapid returns the real public key for a signed-in user', async () => {
    mockUser.current = { id: 'u1', name: 'A', email: 'a@x.test', role: 'member' }
    const res = await vapid()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ publicKey: 'BTestPublicKey_url_safe' })
  })

  it('GET /api/push/vapid is 401 when signed out', async () => {
    const res = await vapid()
    expect(res.status).toBe(401)
  })
})
