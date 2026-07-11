import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import ProfileClient from './profile-client'

export default async function ProfilePage() {
  const su = await requireUser()
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: su.id },
    select: { id: true, name: true, email: true, image: true, title: true, timezone: true, role: true },
  })
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-medium text-subtle">Your account</p>
      <h1 className="mt-1 text-2xl font-semibold text-default">Profile</h1>
      <ProfileClient user={{ id: u.id, name: u.name, email: u.email, image: u.image, title: u.title ?? '', timezone: u.timezone ?? '', role: u.role }} />
    </div>
  )
}
