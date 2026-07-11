import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { setThemePreference } from '@/features/settings/service'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { PATCH as meRoute } from '@/app/api/me/route'

const jreq = (body: unknown) =>
  new Request('http://test/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('setThemePreference service', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('persists a valid theme', async () => {
    const u = await makeUser({ role: 'member' })
    await setThemePreference(u.id, 'dark')
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { themePreference: true } })
    expect(row?.themePreference).toBe('dark')
  })

  it('overwrites an existing preference', async () => {
    const u = await makeUser({ role: 'member' })
    await setThemePreference(u.id, 'dark')
    await setThemePreference(u.id, 'light')
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { themePreference: true } })
    expect(row?.themePreference).toBe('light')
  })
})

describe('PATCH /api/me', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('401 when signed out', async () => {
    expect((await meRoute(jreq({ themePreference: 'dark' }))).status).toBe(401)
  })

  it('400 for an invalid or missing theme', async () => {
    const u = await makeUser({ role: 'member' })
    mockUser.current = { ...u, role: u.role }
    expect((await meRoute(jreq({ themePreference: 'blue' }))).status).toBe(400)
    expect((await meRoute(jreq({}))).status).toBe(400)
  })

  it('200 persists the theme for the signed-in user', async () => {
    const u = await makeUser({ role: 'member' })
    mockUser.current = { ...u, role: u.role }
    const res = await meRoute(jreq({ themePreference: 'dark' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { themePreference: true } })
    expect(row?.themePreference).toBe('dark')
  })

  it('400 for an unknown accent slug', async () => {
    const u = await makeUser({ role: 'member' })
    mockUser.current = { ...u, role: u.role }
    expect((await meRoute(jreq({ accentPreference: 'chartreuse' }))).status).toBe(400)
  })

  it('200 persists a valid accent slug', async () => {
    const u = await makeUser({ role: 'member' })
    mockUser.current = { ...u, role: u.role }
    const res = await meRoute(jreq({ accentPreference: 'crimson' }))
    expect(res.status).toBe(200)
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { accentPreference: true } })
    expect(row?.accentPreference).toBe('crimson')
  })
})
