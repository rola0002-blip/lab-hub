import 'server-only'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from './auth'

export type Role = 'admin' | 'member' | 'guest'
export type SessionUser = { id: string; name: string; email: string; role: Role }

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null
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
