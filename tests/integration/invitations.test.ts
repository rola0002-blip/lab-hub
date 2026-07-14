import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { createInvitation, revokeInvitation, resendInvitation, getPendingInvitation, acceptInviteUrl } from '@/features/invitations/service'

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

  it('acceptInviteUrl builds the APP_URL accept link for a token', async () => {
    const admin = await makeUser({ role: 'admin' })
    const { token } = await createInvitation('link@a.test', 'member', admin.id)
    // env.APP_URL is the integration default (http://localhost:3000).
    expect(acceptInviteUrl(token)).toBe(`http://localhost:3000/accept-invite/${token}`)
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

  it('resend does not resurrect a REVOKED invitation and sends no email', async () => {
    const admin = await makeUser({ role: 'admin' })
    const { token } = await createInvitation('r@a.test', 'member', admin.id)
    const inv = await prisma.invitation.findFirstOrThrow({ where: { token } })
    await revokeInvitation(inv.id)
    await prisma.emailOutbox.deleteMany() // drop the original invite email
    await resendInvitation(inv.id)
    const after = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })
    expect(after.status).toBe('REVOKED') // not flipped back to PENDING
    expect(after.token).toBe(token) // token unchanged (no rotation)
    expect(await prisma.emailOutbox.count()).toBe(0) // no email enqueued
  })

  // DB-level pin: the partial unique index is the concurrency backstop. Two raw
  // PENDING rows for the same address must be rejected by Postgres itself,
  // independent of any service-layer pre-check. Deterministic red before the
  // migration (both inserts succeed without the index).
  it('DB rejects a second PENDING invitation for the same email', async () => {
    const admin = await makeUser({ role: 'admin' })
    const base = { role: 'member', invitedById: admin.id, status: 'PENDING' as const, expiresAt: new Date(Date.now() + 3_600_000) }
    await prisma.invitation.create({ data: { email: 'dup@a.test', token: 'tok-1', ...base } })
    await expect(
      prisma.invitation.create({ data: { email: 'dup@a.test', token: 'tok-2', ...base } }),
    ).rejects.toThrow()
  })

  it('concurrent createInvitation for the same address yields exactly one PENDING row', async () => {
    const admin = await makeUser({ role: 'admin' })
    const results = await Promise.allSettled([
      createInvitation('race@a.test', 'member', admin.id),
      createInvitation('race@a.test', 'member', admin.id),
    ])
    const pending = await prisma.invitation.findMany({ where: { email: 'race@a.test', status: 'PENDING' } })
    expect(pending).toHaveLength(1) // index makes the second insert lose
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) {
      if (r.status === 'rejected') expect((r.reason as Error).message).toBe('already_exists')
    }
  })

  it('re-invites after the pending invitation has expired, leaving one PENDING row', async () => {
    const admin = await makeUser({ role: 'admin' })
    const { token: first } = await createInvitation('again@a.test', 'member', admin.id)
    const inv = await prisma.invitation.findFirstOrThrow({ where: { token: first } })
    // Force the pending invite into the past; the row keeps status='PENDING'.
    await prisma.invitation.update({ where: { id: inv.id }, data: { expiresAt: new Date(Date.now() - 1) } })
    const { token: second } = await createInvitation('again@a.test', 'member', admin.id)
    expect(second).not.toBe(first)
    const pending = await prisma.invitation.findMany({ where: { email: 'again@a.test', status: 'PENDING' } })
    expect(pending).toHaveLength(1) // exactly one live PENDING row
    expect(pending[0].token).toBe(second)
    const old = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })
    expect(old.status).toBe('REVOKED') // the expired row was revoked, not left dangling
  })
})
