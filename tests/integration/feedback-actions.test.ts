import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeFeedback } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))
// revalidatePath throws "outside a request scope" when a Server Action is invoked
// directly in Vitest — stub it (we assert the action's return value, not caching).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setFeedbackStatusAction, deleteFeedbackAction } from '@/app/(app)/feedback/actions'

const signIn = (u: { id: string; name: string; email: string; role: string }) => {
  mockUser.current = { id: u.id, name: u.name, email: u.email, role: u.role }
}
const statusOf = async (id: string) => (await prisma.feedback.findUniqueOrThrow({ where: { id } })).status

// The actions are the ONLY place the service's throws become UI copy. Every failure
// here must come back as `{ ok:false, message }` — the files/actions.ts fail() idiom
// does NOT rethrow, so a rejected promise from any of these is a regression.
describe('feedback server actions', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('setFeedbackStatusAction: an admin triages and the row moves', async () => {
    const admin = await makeUser({ role: 'admin' })
    const member = await makeUser({ role: 'member' })
    const fb = await makeFeedback({ authorId: member.id })
    signIn(admin)
    expect(await setFeedbackStatusAction(fb.id, 'PLANNED')).toEqual({ ok: true })
    expect(await statusOf(fb.id)).toBe('PLANNED')
  })

  it('setFeedbackStatusAction: a member gets the policy message back, never a throw', async () => {
    const member = await makeUser({ role: 'member' })
    const fb = await makeFeedback({ authorId: member.id })
    signIn(member)
    expect(await setFeedbackStatusAction(fb.id, 'PLANNED'))
      .toEqual({ ok: false, message: 'Only admins can review feedback.' })
    expect(await statusOf(fb.id)).toBe('NEW')
  })

  it('setFeedbackStatusAction: an unknown status string is refused before the service runs', async () => {
    const admin = await makeUser({ role: 'admin' })
    const fb = await makeFeedback({ authorId: admin.id })
    signIn(admin)
    expect(await setFeedbackStatusAction(fb.id, 'BOGUS')).toEqual({ ok: false, message: 'Invalid status.' })
    expect(await statusOf(fb.id)).toBe('NEW')
  })

  it('deleteFeedbackAction: the author may delete their own item while it is NEW', async () => {
    const author = await makeUser({ role: 'member' })
    const fb = await makeFeedback({ authorId: author.id })
    signIn(author)
    expect(await deleteFeedbackAction(fb.id)).toEqual({ ok: true })
    expect(await prisma.feedback.findUnique({ where: { id: fb.id } })).toBeNull()
  })

  it("deleteFeedbackAction: another member's item is refused and survives", async () => {
    const author = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })
    const fb = await makeFeedback({ authorId: author.id })
    signIn(other)
    const r = await deleteFeedbackAction(fb.id)
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ message: expect.stringContaining('Only an admin or the author') })
    expect(await prisma.feedback.count()).toBe(1)
  })

  it('deleteFeedbackAction: a row deleted underneath comes back as a result, not a P2025 throw', async () => {
    const admin = await makeUser({ role: 'admin' })
    signIn(admin)
    expect(await deleteFeedbackAction('gone')).toEqual({ ok: false, message: 'Feedback not found.' })
  })
})
