import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetDb, makeUser, makeChannel, makeMember } from '../factories'
import { isActive, _resetActivityForTests } from '@/lib/activity'
import { getSessionUser } from '@/lib/session'

vi.mock('@/lib/session', () => ({
  getSessionUser: vi.fn(async () => ({ id: 'u-act', name: 'U', email: 'u@t.local', role: 'member' as const })),
}))

import { POST } from '@/app/api/activity/route'
import { POST as typingPOST } from '@/app/api/chat/conversations/[id]/typing/route'

describe('POST /api/activity', () => {
  beforeEach(() => { _resetActivityForTests(); vi.mocked(getSessionUser).mockReset() })

  it('marks the session user active (204, no body)', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u-act', name: 'U', email: 'u@t.local', role: 'member' })
    const res = await POST()
    expect(res.status).toBe(204)
    expect(isActive('u-act')).toBe(true)
  })

  it('rejects anonymous callers without touching the map', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null)
    const res = await POST()
    expect(res.status).toBe(401)
    expect(isActive('u-act')).toBe(false)
  })

  it('the typing route also marks activity (typing IS being at the keyboard)', async () => {
    await resetDb()
    const u = await makeUser()
    const ch = await makeChannel()
    await makeMember(ch.id, u.id)
    vi.mocked(getSessionUser).mockResolvedValue({ id: u.id, name: u.name, email: u.email, role: 'member' })
    const res = await typingPOST(new Request('http://x/'), { params: Promise.resolve({ id: ch.id }) })
    expect(res.status).toBe(200)
    expect(isActive(u.id)).toBe(true)
  })
})
