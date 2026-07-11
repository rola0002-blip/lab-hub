import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/session'
import PeopleClient from './people-client'

export default async function PeoplePage() {
  const user = await requireUser()
  if (user.role === 'guest') redirect('/dashboard')
  const [users, invitations] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true, role: true, banned: true, title: true, timezone: true } }),
    prisma.invitation.findMany({ where: { status: 'PENDING', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
  ])
  return (
    <div>
      <p className="text-sm font-medium text-subtle">02 — People</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">People</h1>
      <PeopleClient users={users.map((u) => ({ ...u, title: u.title ?? null, timezone: u.timezone ?? null }))} invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role }))} isAdmin={user.role === 'admin'} selfId={user.id} />
    </div>
  )
}
