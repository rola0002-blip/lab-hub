import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))
// revalidatePath throws "outside a request scope" when a Server Action is invoked
// directly in Vitest — stub it (we assert the action's return value, not caching).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { inviteAction } from '@/app/(app)/people/actions'

describe('inviteAction (copyable link)', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('returns ok + the accept URL for the freshly-minted token', async () => {
    const admin = await makeUser({ role: 'admin' })
    mockUser.current = { id: admin.id, name: admin.name, email: admin.email, role: admin.role }
    const r = await inviteAction('newbie@lab.test', 'member')
    expect(r.ok).toBe(true)
    const inv = await prisma.invitation.findFirstOrThrow({ where: { email: 'newbie@lab.test' } })
    expect(r.url).toBe(`http://localhost:3000/accept-invite/${inv.token}`)
  })

  it('returns a friendly error (no url) for a duplicate', async () => {
    const admin = await makeUser({ role: 'admin' })
    mockUser.current = { id: admin.id, name: admin.name, email: admin.email, role: admin.role }
    await inviteAction('dup@lab.test', 'member')
    const r = await inviteAction('dup@lab.test', 'member')
    expect(r.ok).toBe(false)
    expect(r.url).toBeUndefined()
  })
})
