import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetDb, makeUser } from '../factories'
import { prisma } from '@/lib/db'
import { saveUpload } from '@/lib/uploads'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { POST as avatarPost, DELETE as avatarDelete } from '@/app/api/me/avatar/route'
import { GET as uploadRoute } from '@/app/uploads/[...path]/route'

const png = () => new File([new Uint8Array(128)], 'me.png', { type: 'image/png' })
const postReq = (file: File | null) => {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return new Request('http://t/api/me/avatar', { method: 'POST', body: fd })
}
const partsOf = (p: string) => p.replace(/^\/uploads\//, '').split('/')
const uploadReq = (p: string, params: string[]) =>
  uploadRoute(new Request('http://t' + p), { params: Promise.resolve({ path: params }) })

describe('avatar upload', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('401 when signed out', async () => {
    expect((await avatarPost(postReq(png()))).status).toBe(401)
  })

  it('happy path: stores under avatars/ and sets user.image', async () => {
    const u = await makeUser({ role: 'member' })
    mockUser.current = { ...u, role: u.role }
    const res = await avatarPost(postReq(png()))
    expect(res.status).toBe(200)
    const d = await res.json()
    expect(d.image).toMatch(/^\/uploads\/avatars\/[0-9a-f-]+\.png$/)
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { image: true } })
    expect(row?.image).toBe(d.image)
  })

  it('400 on wrong type and 400 on oversize', async () => {
    const u = await makeUser({ role: 'member' })
    mockUser.current = { ...u, role: u.role }
    const svg = new File([new Uint8Array(16)], 'x.svg', { type: 'image/svg+xml' })
    expect((await avatarPost(postReq(svg))).status).toBe(400)
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    expect((await avatarPost(postReq(big))).status).toBe(400)
  })

  it('traversal-safe stored filename: server generates the name, ignoring the client filename', async () => {
    const u = await makeUser({ role: 'member' })
    mockUser.current = { ...u, role: u.role }
    const evil = new File([new Uint8Array(64)], '../../etc/passwd.png', { type: 'image/png' })
    const res = await avatarPost(postReq(evil))
    expect(res.status).toBe(200)
    expect((await res.json()).image).toMatch(/^\/uploads\/avatars\/[0-9a-f-]+\.png$/)
  })

  it('remove nulls user.image', async () => {
    const u = await makeUser({ role: 'member' })
    mockUser.current = { ...u, role: u.role }
    await avatarPost(postReq(png()))
    expect((await avatarDelete()).status).toBe(200)
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { image: true } })
    expect(row?.image).toBeNull()
  })

  it('/uploads/avatars/* requires a session: 401 anon, 200 authed (private no-store)', async () => {
    const u = await makeUser({ role: 'member' })
    mockUser.current = { ...u, role: u.role }
    const stored = await saveUpload(png(), 'avatars')
    const parts = partsOf(stored)

    mockUser.current = null
    expect((await uploadReq(stored, parts)).status).toBe(401)

    mockUser.current = { ...u, role: u.role }
    const ok = await uploadReq(stored, parts)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Cache-Control')).toBe('private, no-store')
  })
})
