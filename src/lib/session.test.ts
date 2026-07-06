import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the framework + auth seams so the guard control-flow is unit-testable
// without a request context or DB. redirect() throws a sentinel we can assert on
// (mirroring Next's real behaviour of throwing to halt rendering).
const getSession = vi.fn()
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`)
  },
}))
vi.mock('./auth', () => ({ auth: { api: { getSession: () => getSession() } } }))

import { getSessionUser, requireUser, requireAdmin } from './session'

const user = (over = {}) => ({ user: { id: 'u1', name: 'A', email: 'a@x', role: 'member', banned: false, ...over } })

beforeEach(() => getSession.mockReset())

describe('getSessionUser', () => {
  it('returns null when there is no session', async () => {
    getSession.mockResolvedValue(null)
    expect(await getSessionUser()).toBeNull()
  })
  it('returns null for a banned user', async () => {
    getSession.mockResolvedValue(user({ banned: true }))
    expect(await getSessionUser()).toBeNull()
  })
  it('maps a valid session and defaults a missing role to guest', async () => {
    getSession.mockResolvedValue(user({ role: undefined }))
    expect(await getSessionUser()).toEqual({ id: 'u1', name: 'A', email: 'a@x', role: 'guest' })
  })
  it('passes through an explicit role', async () => {
    getSession.mockResolvedValue(user({ role: 'admin' }))
    expect((await getSessionUser())?.role).toBe('admin')
  })
})

describe('requireUser', () => {
  it('redirects to /sign-in when unauthenticated', async () => {
    getSession.mockResolvedValue(null)
    await expect(requireUser()).rejects.toThrow('REDIRECT:/sign-in')
  })
  it('returns the user when authenticated', async () => {
    getSession.mockResolvedValue(user())
    expect((await requireUser()).id).toBe('u1')
  })
})

describe('requireAdmin', () => {
  it('redirects non-admins to /dashboard', async () => {
    getSession.mockResolvedValue(user({ role: 'member' }))
    await expect(requireAdmin()).rejects.toThrow('REDIRECT:/dashboard')
  })
  it('returns admins unchanged', async () => {
    getSession.mockResolvedValue(user({ role: 'admin' }))
    expect((await requireAdmin()).role).toBe('admin')
  })
})
