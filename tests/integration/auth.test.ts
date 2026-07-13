import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { resetDb, seedSystem } from '../factories'
import { LAB_UPDATES_CHANNEL_ID, COLOSSUS_BOT_ID } from '@/features/bot'

async function completeSetup() {
  await prisma.organization.create({ data: { name: 'TAY LABS', setupComplete: true } })
}

describe('auth signup gate', () => {
  beforeEach(resetDb)

  it('allows first-admin signup while setup is incomplete and assigns admin role', async () => {
    await auth.api.signUpEmail({ body: { email: 'pi@lab.test', password: 'Str0ngPass!123', name: 'PI' } })
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'pi@lab.test' } })
    expect(u.role).toBe('admin')
  })

  it('rejects signup without an invitation once setup is complete', async () => {
    await completeSetup()
    await expect(
      auth.api.signUpEmail({ body: { email: 'rando@evil.test', password: 'Str0ngPass!123', name: 'X' } }),
    ).rejects.toThrow()
    expect(await prisma.user.count()).toBe(0)
  })

  it('accepts invited signup, applies the invited role, and marks the invitation ACCEPTED', async () => {
    await completeSetup()
    await prisma.invitation.create({
      data: { email: 'fyp@ntu.test', role: 'guest', token: 'tok1', invitedById: 'x', expiresAt: new Date(Date.now() + 86_400_000) },
    })
    await auth.api.signUpEmail({ body: { email: 'fyp@ntu.test', password: 'Str0ngPass!123', name: 'FYP' } })
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'fyp@ntu.test' } })
    expect(u.role).toBe('guest')
    const inv = await prisma.invitation.findFirstOrThrow({ where: { email: 'fyp@ntu.test' } })
    expect(inv.status).toBe('ACCEPTED')
  })

  it('rejects signup with an expired invitation', async () => {
    await completeSetup()
    await prisma.invitation.create({
      data: { email: 'late@ntu.test', role: 'member', token: 'tok2', invitedById: 'x', expiresAt: new Date(Date.now() - 1000) },
    })
    await expect(
      auth.api.signUpEmail({ body: { email: 'late@ntu.test', password: 'Str0ngPass!123', name: 'L' } }),
    ).rejects.toThrow()
  })

  it('signs in with correct password and rejects a wrong one', async () => {
    await auth.api.signUpEmail({ body: { email: 'pi@lab.test', password: 'Str0ngPass!123', name: 'PI' } })
    const ok = await auth.api.signInEmail({ body: { email: 'pi@lab.test', password: 'Str0ngPass!123' } })
    expect(ok.user.email).toBe('pi@lab.test')
    await expect(auth.api.signInEmail({ body: { email: 'pi@lab.test', password: 'wrong' } })).rejects.toThrow()
  })

  it('promotes the first HUMAN to admin even when the bot row already exists', async () => {
    await seedSystem()      // a pre-seeded isSystem bot is present before setup
    // Setup is still incomplete when the first admin signs up (matches the real
    // bootstrap: prisma/migrations seed the bot BEFORE the setup wizard runs, and
    // setup/actions.ts only flips setupComplete AFTER the admin sign-up succeeds).
    // First human sign-up → still the only non-system user → promoted to admin.
    await auth.api.signUpEmail({ body: { email: 'pi@lab.test', password: 'Str0ngPass!123', name: 'Roland' } })
    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'pi@lab.test' } })
    expect(row.role).toBe('admin')
  })

  it('auto-joins a newly created human to #lab-updates', async () => {
    await seedSystem()
    await auth.api.signUpEmail({ body: { email: 'a@lab.test', password: 'Str0ngPass!123', name: 'A' } })
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'a@lab.test' } })
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: LAB_UPDATES_CHANNEL_ID, userId: u.id } },
    })
    expect(member).not.toBeNull()
    // The bot is never a promotion target and stays member-role.
    const bot = await prisma.user.findUniqueOrThrow({ where: { id: COLOSSUS_BOT_ID } })
    expect(bot.role).toBe('member')
  })
})
