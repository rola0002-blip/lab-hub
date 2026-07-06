import 'server-only'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { enqueueEmail } from '@/lib/email/outbox'
import { inviteEmail } from '@/lib/email/templates'
import { env } from '@/lib/env'

const EXPIRY_MS = 7 * 24 * 3_600_000
const newToken = () => randomBytes(32).toString('base64url')

async function sendInvite(email: string, token: string) {
  const org = await prisma.organization.findFirst()
  const t = inviteEmail(org?.name ?? 'LabHub', `${env.APP_URL}/accept-invite/${token}`)
  await enqueueEmail(email, t.subject, t.html)
}

export async function createInvitation(email: string, role: 'admin' | 'member' | 'guest', invitedById: string): Promise<{ token: string }> {
  const addr = email.trim().toLowerCase()
  const [user, pending] = await Promise.all([
    prisma.user.findUnique({ where: { email: addr } }),
    prisma.invitation.findFirst({ where: { email: addr, status: 'PENDING', expiresAt: { gt: new Date() } } }),
  ])
  if (user || pending) throw new Error('already_exists')
  const token = newToken()
  await prisma.invitation.create({ data: { email: addr, role, token, invitedById, expiresAt: new Date(Date.now() + EXPIRY_MS) } })
  await sendInvite(addr, token)
  return { token }
}

export async function revokeInvitation(id: string): Promise<void> {
  await prisma.invitation.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REVOKED' } })
}

export async function resendInvitation(id: string): Promise<void> {
  const token = newToken()
  // Guard on status so a REVOKED/ACCEPTED invitation is never resurrected to
  // PENDING. updateMany reports 0 affected rows when the guard fails; bail
  // without emailing. Preserves PENDING behaviour: new token, +7d expiry, re-email.
  const { count } = await prisma.invitation.updateMany({
    where: { id, status: 'PENDING' },
    data: { token, expiresAt: new Date(Date.now() + EXPIRY_MS) },
  })
  if (count === 0) return
  const inv = await prisma.invitation.findUniqueOrThrow({ where: { id } })
  await sendInvite(inv.email, token)
}

export async function getPendingInvitation(token: string) {
  const inv = await prisma.invitation.findUnique({ where: { token } })
  if (!inv || inv.status !== 'PENDING' || inv.expiresAt <= new Date()) return null
  return { id: inv.id, email: inv.email, role: inv.role }
}
