import { describe, it, expect } from 'vitest'
import pkg from '../../package.json'
import { GET } from '@/app/api/health/route'

// No session mock is installed on purpose: the route must answer 200 with NO auth.
// If it ever grew a session/DB check, an unauthenticated call would fail here.
describe('GET /api/health', () => {
  it('returns 200 { ok:true, version } unauthenticated, and nothing else', async () => {
    const res = GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, version: pkg.version })
    expect(Object.keys(body).sort()).toEqual(['ok', 'version']) // exact key set — no leakage
  })
})
