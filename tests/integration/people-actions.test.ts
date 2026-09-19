import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, seedSystem } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))
// revalidatePath throws "outside a request scope" when a Server Action is invoked
// directly in Vitest — stub it (we assert the action's return value, not caching).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setRoleAction, deactivateAction, inviteAction } from '@/app/(app)/people/actions'
import { COLOSSUS_BOT_ID } from '@/features/bot/ids'

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

describe('setRoleAction / deactivateAction guards (Task 10)', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  async function asAdmin() {
    const admin = await makeUser({ role: 'admin' })
    mockUser.current = { id: admin.id, name: admin.name, email: admin.email, role: admin.role }
    return admin
  }

  it('rejects role changes and deactivation for system accounts', async () => {
    await asAdmin()
    await seedSystem()
    expect(await setRoleAction(COLOSSUS_BOT_ID, 'admin')).toMatchObject({ ok: false })
    expect(await deactivateAction(COLOSSUS_BOT_ID)).toMatchObject({ ok: false })
    const bot = await prisma.user.findUniqueOrThrow({ where: { id: COLOSSUS_BOT_ID } })
    expect(bot.role).toBe('member')
    expect(bot.banned).toBe(false)
  })

  it('rejects an unknown user id (no mutation, friendly error)', async () => {
    await asAdmin()
    expect(await setRoleAction('no-such-user', 'admin')).toMatchObject({ ok: false })
    expect(await deactivateAction('no-such-user')).toMatchObject({ ok: false })
  })

  it('an invalid role returns early instead of throwing (safeParse at the RPC boundary)', async () => {
    await asAdmin()
    const u = await makeUser()
    expect(await setRoleAction(u.id, 'superadmin')).toMatchObject({ ok: false })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('member')
  })

  it('a human target still goes through', async () => {
    await asAdmin()
    const u = await makeUser()
    expect(await setRoleAction(u.id, 'guest')).toMatchObject({ ok: true })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('guest')
  })
})
