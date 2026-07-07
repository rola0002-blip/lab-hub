import 'server-only'
import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { enqueueEmail } from '@/lib/email/outbox'
import { inviteEmail } from '@/lib/email/templates'
import { env } from '@/lib/env'

const EXPIRY_MS = 7 * 24 * 3_600_000
const newToken = () => randomBytes(32).toString('base64url')

// The partial unique index `invitation_pending_email_unique` (one PENDING row
// per email) is the concurrency backstop for the pre-check TOCTOU. Detect its
// violation the same way `isOverlapError` handles booking_no_overlap: a Prisma
// P2002 unique failure, or the raw error naming the index.
function isDuplicateInviteError(e: unknown): boolean {
  const msg = String(e instanceof Prisma.PrismaClientKnownRequestError ? e.message : e)
  return (
    (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') ||
    msg.includes('invitation_pending_email_unique')
  )
}

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
  // Expired PENDING rows still carry status='PENDING' and would collide with the
  // partial unique index on re-invite. Revoke them first. The pre-check's
  // `expiresAt: { gt: now }` guard means live PENDING rows are untouched here —
  // they keep blocking via the pre-check above / the index below.
  await prisma.invitation.updateMany({
    where: { email: addr, status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'REVOKED' },
  })
  const token = newToken()
  try {
    await prisma.invitation.create({ data: { email: addr, role, token, invitedById, expiresAt: new Date(Date.now() + EXPIRY_MS) } })
  } catch (e) {
    // Concurrency backstop: a racing invite committed a PENDING row for this
    // address between our pre-check and insert. Map to the same friendly error.
    if (isDuplicateInviteError(e)) throw new Error('already_exists')
    throw e
  }
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
