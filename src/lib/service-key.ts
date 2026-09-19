import 'server-only'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { COLOSSUS_BOT_ID } from '@/features/bot/ids'
import type { SessionUser } from './session'

// Service API keys (the service-api-key + labhub-mcp design, 2026-09-09):
// `Authorization: Bearer labhub_<base64url>` checked ONLY after the session-cookie
// path yields no session, so the cookie always wins and headless callers fall
// through. sha256-hex lookup (not argon2) is the standard API-key posture — the
// secret is a 256-bit random token, not a low-entropy password. Every valid key
// resolves to the LabHub Bot; there is no per-key user mapping in v1.
export async function resolveServiceKeyUser(headerValue: string | null): Promise<SessionUser | null> {
  const m = /^Bearer (labhub_[A-Za-z0-9_-]+)$/.exec(headerValue ?? '')
  if (!m) return null
  const key = await prisma.serviceKey.findFirst({ where: { tokenHash: sha256hex(m[1]), revokedAt: null } })
  if (!key) return null
  const bot = await prisma.user.findUnique({ where: { id: COLOSSUS_BOT_ID }, select: { name: true, email: true, banned: true } })
  // A banned service identity is dead: no key minted for it authenticates, and the
  // lastUsedAt touch is skipped so the audit trail shows the rejection, not a use.
  if (!bot || bot.banned) return null
  // Fire-and-forget telemetry: a failed lastUsedAt write must never fail the request.
  void prisma.serviceKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  return { id: COLOSSUS_BOT_ID, name: bot.name, email: bot.email, role: 'member' }
}

function sha256hex(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
