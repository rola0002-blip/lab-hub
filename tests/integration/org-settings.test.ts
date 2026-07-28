import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: 'admin' | 'member' | 'guest' } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => { if (!mockUser.current) throw new Error('NEXT_REDIRECT'); return mockUser.current },
  requireAdmin: async () => { if (mockUser.current?.role !== 'admin') throw new Error('NEXT_REDIRECT'); return mockUser.current },
}))
// revalidatePath throws "static generation store missing" when a Server Action is
// invoked directly in Vitest — stub it (we assert persistence, not caching), the
// same seam tests/integration/people-actions.test.ts uses.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { updateOrgAction } from '@/app/(app)/admin/settings/actions'

function fd(over: Record<string, string> = {}) {
  const f = new FormData()
  f.set('name', 'Lab'); f.set('accentColor', '#0d9488'); f.set('timezone', 'Asia/Singapore')
  f.set('updatePromptDay', '1'); f.set('updatePromptHour', '9')
  for (const [k, v] of Object.entries(over)) f.set(k, v)
  return f
}

describe('org cadence settings (SP8 §4.2)', () => {
  beforeEach(async () => {
    await resetDb()
    await prisma.organization.create({ data: { name: 'Lab', setupComplete: true } })
    mockUser.current = { id: 'a1', name: 'Admin', email: 'a@lab.test', role: 'admin' }
  })
  it('persists day+hour; org defaults were Tuesday 16', async () => {
    expect((await prisma.organization.findFirstOrThrow()).updatePromptDay).toBe(2)
    const r = await updateOrgAction(fd())
    expect(r.ok).toBe(true)
    const org = await prisma.organization.findFirstOrThrow()
    expect(org.updatePromptDay).toBe(1)
    expect(org.updatePromptHour).toBe(9)
  })
  it('rejects out-of-range values with ok:false', async () => {
    expect((await updateOrgAction(fd({ updatePromptDay: '7' }))).ok).toBe(false)
    expect((await updateOrgAction(fd({ updatePromptHour: '24' }))).ok).toBe(false)
  })
  it('non-admins are redirected (requireAdmin), org unchanged', async () => {
    mockUser.current = { id: 'g1', name: 'G', email: 'g@lab.test', role: 'guest' }
    await expect(updateOrgAction(fd())).rejects.toThrow()
    expect((await prisma.organization.findFirstOrThrow()).updatePromptDay).toBe(2)
  })
})
