import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSessionUser } from '@/lib/session'

vi.mock('@/lib/session', () => ({
  getSessionUser: vi.fn(async () => ({ id: 'u-test', name: 'U', email: 'u@t.local', role: 'member' as const })),
}))
vi.mock('@/lib/push', () => ({
  sendPush: vi.fn(async () => {}),
}))

import { sendPush } from '@/lib/push'
import { POST } from '@/app/api/push/test/route'

describe('POST /api/push/test', () => {
  beforeEach(() => { vi.mocked(getSessionUser).mockReset(); vi.mocked(sendPush).mockClear() })

  it('pushes a test notification to the caller only', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ id: 'u-test', name: 'U', email: 'u@t.local', role: 'member' })
    const res = await POST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(sendPush).toHaveBeenCalledTimes(1)
    expect(sendPush).toHaveBeenCalledWith('u-test', expect.objectContaining({ tag: 'test' }))
  })

  it('rejects anonymous callers', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null)
    const res = await POST()
    expect(res.status).toBe(401)
    expect(sendPush).not.toHaveBeenCalled()
  })
})
