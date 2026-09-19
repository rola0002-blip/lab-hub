import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { env } from '@/lib/env'
import { ensureIcsToken } from '@/features/calendar/token-service'
import { PageHeader } from '@/components/page-header'
import ProfileClient from './profile-client'
import { CalendarSyncCard } from './calendar-sync-card'

export default async function ProfilePage() {
  const su = await requireUser()
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: su.id },
    select: { id: true, name: true, email: true, image: true, title: true, timezone: true, role: true, soundsEnabled: true },
  })
  // Mint on first open (idempotent; concurrent opens converge via the unique column).
  const icsToken = await ensureIcsToken(su.id)
  const host = new URL(env.APP_URL).host
  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="Your account" title="Profile" />
      <ProfileClient user={{ id: u.id, name: u.name, email: u.email, image: u.image, title: u.title ?? '', timezone: u.timezone ?? '', role: u.role }} soundsEnabled={u.soundsEnabled} />
      <div className="mt-8"><CalendarSyncCard initialToken={icsToken} host={host} /></div>
    </div>
  )
}
