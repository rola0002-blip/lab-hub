import Image from 'next/image'
import { requireSetup } from '@/lib/org'
import { requireUser } from '@/lib/session'
import { totalUnread } from '@/features/chat/conversation-service'
import Sidebar, { type NavItem } from '@/components/sidebar'
import Bell from '@/components/bell'
import PushOptIn from '@/components/push-optin'
import SignOutButton from '@/components/sign-out'
import { ThemeToggle } from '@/components/theme-toggle'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const org = await requireSetup()
  const user = await requireUser()
  const chatUnread = await totalUnread(user.id)

  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/chat', label: chatUnread > 0 ? `Chat (${chatUnread > 99 ? '99+' : chatUnread})` : 'Chat' },
    { href: '/booking', label: 'Booking' },
    { href: '/bookings', label: 'My bookings' },
  ]
  if (user.role !== 'guest') {
    items.push({ href: '/approvals', label: 'Approvals' })
    items.push({ href: '/people', label: 'People' })
    items.push({ href: '/certifications', label: 'Certifications' })
  }
  if (user.role === 'admin') {
    items.push({ href: '/admin/equipment', label: 'Equipment' })
    items.push({ href: '/admin/settings', label: 'Settings' })
  }

  return (
    <div className="flex min-h-screen">
      <style>{`:root{--accent:${org.accentColor}}`}</style>
      <aside className="w-56 shrink-0 border-r border-gray-200">
        <div className="flex items-center gap-2 p-4">
          {org.logoPath ? <Image src={org.logoPath} alt="" width={28} height={28} unoptimized className="rounded" /> : null}
          <span className="font-semibold tracking-tight">{org.name}</span>
        </div>
        <Sidebar items={items} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-2 border-b border-gray-200 px-6 py-3">
          <PushOptIn />
          <ThemeToggle />
          <Bell />
          <span className="text-sm text-gray-600">{user.name}</span>
          <SignOutButton />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
