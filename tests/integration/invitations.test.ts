import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { createInvitation, revokeInvitation, resendInvitation, getPendingInvitation } from '@/features/invitations/service'

describe('invitations', () => {
  beforeEach(resetDb)

  it('creates invitation with token, queues email, lowercases address', async () => {
    const admin = await makeUser({ role: 'admin' })
    const { token } = await createInvitation('FYP@NTU.test', 'guest', admin.id)
    const inv = await getPendingInvitation(token)
    expect(inv?.email).toBe('fyp@ntu.test')
    expect(inv?.role).toBe('guest')
    const mail = await prisma.emailOutbox.findFirstOrThrow()
    expect(mail.toEmail).toBe('fyp@ntu.test')
    expect(mail.html).toContain(`/accept-invite/${token}`)
  })

  it('refuses duplicate pending invitation or existing user', async () => {
    const admin = await makeUser({ role: 'admin' })
    await createInvitation('x@a.test', 'member', admin.id)
    await expect(createInvitation('x@a.test', 'member', admin.id)).rejects.toThrow('already_exists')
    await expect(createInvitation(admin.email, 'member', admin.id)).rejects.toThrow('already_exists')
  })

  it('revoked and expired invitations resolve to null', async () => {
    const admin = await makeUser({ role: 'admin' })
    const { token } = await createInvitation('y@a.test', 'member', admin.id)
    const inv = await prisma.invitation.findFirstOrThrow({ where: { token } })
    await revokeInvitation(inv.id)
    expect(await getPendingInvitation(token)).toBeNull()
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'PENDING', expiresAt: new Date(Date.now() - 1) } })
    expect(await getPendingInvitation(token)).toBeNull()
  })

  it('resend rotates the token and extends expiry', async () => {
    const admin = await makeUser({ role: 'admin' })
    const { token } = await createInvitation('z@a.test', 'member', admin.id)
    const inv = await prisma.invitation.findFirstOrThrow({ where: { token } })
    await resendInvitation(inv.id)
    expect(await getPendingInvitation(token)).toBeNull()
    const rotated = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })
    expect(rotated.token).not.toBe(token)
    expect(await getPendingInvitation(rotated.token)).not.toBeNull()
  })
})
