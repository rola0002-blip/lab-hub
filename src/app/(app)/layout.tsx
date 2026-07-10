import { requireSetup } from '@/lib/org'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { totalUnread } from '@/features/chat/conversation-service'
import { Sidebar } from '@/components/sidebar'
import Bell from '@/components/bell'
import PushOptIn from '@/components/push-optin'
import { ThemeToggle, ThemeSync } from '@/components/theme-toggle'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const org = await requireSetup()
  const user = await requireUser()
  const chatUnread = await totalUnread(user.id)
  // Read the saved per-user theme + avatar directly (not part of the session
  // contract); ThemeSync applies the theme on the device only when localStorage
  // has no choice yet.
  const pref = await prisma.user.findUnique({ where: { id: user.id }, select: { themePreference: true, image: true } })

  return (
    <div className="flex min-h-screen">
      <ThemeSync initial={pref?.themePreference ?? null} />
      <style>{`:root{--accent:${org.accentColor}}`}</style>
      <Sidebar
        org={{ name: org.name, logoPath: org.logoPath }}
        user={{ id: user.id, name: user.name, image: pref?.image ?? null }}
        unread={chatUnread}
        role={user.role}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-end gap-2 border-b border-border px-6">
          <PushOptIn />
          <ThemeToggle />
          <Bell />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
