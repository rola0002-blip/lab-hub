import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetDb, makeUser, seedSystem } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { POST as uploadDoc } from '@/app/api/documents/route'
import { GET as serve } from '@/app/uploads/[...path]/route'

const partsOf = (publicPath: string) => publicPath.replace(/^\/uploads\//, '').split('/')
const serveReq = (publicPath: string) => serve(new Request('http://t' + publicPath), { params: Promise.resolve({ path: partsOf(publicPath) }) })
const uploadReq = (form: FormData) => uploadDoc(new Request('http://t/api/documents', { method: 'POST', body: form }))
const fileForm = (file: File) => { const f = new FormData(); f.set('file', file); return f }

describe('uploads route — internet-facing nosniff', () => {
  beforeEach(async () => { await resetDb(); await seedSystem(); mockUser.current = null })

  it('sets X-Content-Type-Options: nosniff on a served document (inline attacker bytes can never be MIME-sniffed)', async () => {
    const m = await makeUser({ role: 'member' })
    mockUser.current = { ...m, role: 'member' }
    const up = await uploadReq(fileForm(new File([new Uint8Array(32)], 'report.pdf', { type: 'application/pdf' })))
    expect(up.status).toBe(201)
    const path = (await up.json()).path
    const res = await serveReq(path)
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})
