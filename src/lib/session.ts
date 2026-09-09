import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from './auth'
import { resolveServiceKeyUser } from './service-key'

export type Role = 'admin' | 'member' | 'guest'
export type SessionUser = { id: string; name: string; email: string; role: Role }

export async function getSessionUser(): Promise<SessionUser | null> {
  const h = await headers()
  const session = await auth.api.getSession({ headers: h })
  // No session cookie → try the service-key bearer fallback (headless callers).
  // A present-but-banned session stays null: the cookie path's behaviour is unchanged.
  if (!session) return resolveServiceKeyUser(h.get('authorization'))
  const { id, name, email, role, banned } = session.user as typeof session.user & { role: Role; banned: boolean }
  if (banned) return null
  return { id, name, email, role: role ?? 'guest' }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/sign-in')
  return user
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== 'admin') redirect('/dashboard')
  return user
}
