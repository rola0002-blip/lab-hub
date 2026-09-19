import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../factories'
import { auth } from '@/lib/auth'

beforeEach(() => resetDb())

async function seedOrgAndInvite() {
  await prisma.organization.create({ data: { name: 'L', timezone: 'Asia/Singapore', setupComplete: true } })
  return prisma.invitation.create({ data: { email: 'new@t.dev', role: 'member', token: 'tok123', invitedById: 'x', status: 'PENDING', expiresAt: new Date(Date.now() + 86_400_000) } })
}

describe('invitation-gated signup', () => {
  it('rejects a direct signUp for an invited email (no invite context)', async () => {
    await seedOrgAndInvite()
    await expect(auth.api.signUpEmail({ body: { email: 'new@t.dev', name: 'X', password: 'password123' } }))
      .rejects.toThrowError(/invitation link/i)
    expect(await prisma.user.count({ where: { isSystem: false } })).toBe(0)
  })

  it('rejects when the presented token is wrong even inside the authorized context', async () => {
    await seedOrgAndInvite()
    // A token can only be "presented" to the server action — the ALS context itself
    // carries no token, so a wrong token must die at the action's re-validation
    // before any sign-up is attempted.
    const { acceptInviteAction } = await import('@/app/(auth)/accept-invite/[token]/actions')
    const r = await acceptInviteAction('wrong-token', 'X', 'password123')
    expect(r.ok).toBe(false)
    expect(await prisma.user.count({ where: { email: 'new@t.dev' } })).toBe(0)
  })

  it('creates the account with the invited role only through the token-validated action', async () => {
    await seedOrgAndInvite()
    const { acceptInviteAction } = await import('@/app/(auth)/accept-invite/[token]/actions')
    const r = await acceptInviteAction('tok123', 'New Person', 'password123')
    expect(r).toEqual({ ok: true })
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'new@t.dev' } })
    expect(u.role).toBe('member')
    expect(u.banned).toBe(false)
    const inv = await prisma.invitation.findUniqueOrThrow({ where: { token: 'tok123' } })
    expect(inv.status).toBe('ACCEPTED')
  })
})
