import 'server-only'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'

// 32-byte base64url token, mirroring the invitation-token pattern
// (src/features/invitations/service.ts). Nullable-unique column → token-less users
// never collide.
const mint = () => randomBytes(32).toString('base64url')

// Lazy + idempotent: concurrent first-opens converge on one token. The conditional
// updateMany (icsToken still null) lets only the first writer win; a racing caller
// sees count 0 and re-reads the committed token.
export async function ensureIcsToken(userId: string): Promise<string> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { icsToken: true } })
  if (u.icsToken) return u.icsToken
  const token = mint()
  const { count } = await prisma.user.updateMany({ where: { id: userId, icsToken: null }, data: { icsToken: token } })
  if (count === 1) return token
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { icsToken: true } })).icsToken!
}

// Rotate: the old URL 404s immediately (revocation).
export async function regenerateIcsToken(userId: string): Promise<string> {
  const token = mint()
  await prisma.user.update({ where: { id: userId }, data: { icsToken: token } })
  return token
}
