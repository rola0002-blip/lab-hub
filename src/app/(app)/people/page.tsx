import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import { acceptInviteUrl } from '@/features/invitations/service'
import PeopleClient from './people-client'

export default async function PeoplePage() {
  const user = await requireUser()
  if (user.role === 'guest') redirect('/dashboard')
  const [users, invitations] = await Promise.all([
    prisma.user.findMany({ where: { isSystem: false }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true, role: true, banned: true, title: true, timezone: true } }),
    prisma.invitation.findMany({ where: { status: 'PENDING', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, role: true, token: true } }),
  ])
  const isAdmin = user.role === 'admin'
  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — People</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">People</h1>
      {/* Invite tokens embed in the accept URL; the pending-invitations UI is admin-only,
          so only admins receive the URLs — non-admins get [] and the token never enters
          their RSC payload (/people is member-reachable, not admin-gated at the route). */}
      <PeopleClient users={users.map((u) => ({ ...u, title: u.title ?? null, timezone: u.timezone ?? null }))} invitations={isAdmin ? invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, url: acceptInviteUrl(i.token) })) : []} isAdmin={isAdmin} selfId={user.id} />
    </div>
  )
}
