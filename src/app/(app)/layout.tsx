import { requireSetup } from '@/lib/org'
import { requireUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { totalUnread } from '@/features/chat/conversation-service'
import { listProjectOptions } from '@/features/issues/project-service'
import { listLabels } from '@/features/issues/issue-service'
import { Sidebar } from '@/components/sidebar'
import { APP_VERSION } from '@/lib/version'
import Bell from '@/components/bell'
import { ThemeToggle, ThemeSync } from '@/components/theme-toggle'
import { AccentSync } from '@/components/accent-picker'
import { ChatProvider } from '@/components/chat/chat-store'
import { CommandPalette } from '@/components/command-palette'
import { CreateIssueModal } from '@/components/issues/create-issue-modal'
import { FeedbackDialog } from '@/components/feedback-dialog'
import { ImageViewerDialog } from '@/components/chat/image-viewer-dialog'
import { ProjectUpdateModal } from '@/components/issues/project-update-modal'
import { IssueHotkeys } from '@/components/issues/issue-hotkeys'
import { ChatTitleBadge } from '@/components/chat-title-badge'
import { SwRegister } from '@/components/sw-register'
import { UserMenu } from '@/components/user-menu'
import { ToastHost } from '@/components/ui/toast'
import { RegionCycler } from '@/components/region-cycler'
import { MobileNavProvider, MobileNavToggle, MobileNavDrawer } from '@/components/mobile-nav'
import { BackButton } from '@/components/back-button'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const org = await requireSetup()
  const user = await requireUser()
  const chatUnread = await totalUnread(user.id)
  // Read the saved per-user theme + avatar directly (not part of the session
  // contract); ThemeSync applies the theme on the device only when localStorage
  // has no choice yet.
  const pref = await prisma.user.findUnique({ where: { id: user.id }, select: { themePreference: true, accentPreference: true, soundsEnabled: true, image: true } })
  // Small org-wide option lists for the globally-mounted create-issue composer
  // (raised by the `c` shortcut, the ⌘K "Create issue" command, and any
  // "New issue" button); the modal itself gates opening for guests. The project
  // list is ONE source — the project-update composer reads the same array.
  // Labels (wave 8) feed the composer's Labels picker — same one-query posture
  // at lab scale as the issue pages' listLabels().
  const [issueUsers, issueProjects, issueLabels] = await Promise.all([
    prisma.user.findMany({ where: { banned: false, isSystem: false }, orderBy: { name: 'asc' }, select: { id: true, name: true, image: true } }),
    listProjectOptions(),
    listLabels(),
  ])

  return (
    // ChatProvider is lifted to the app shell (was chat-only) so the global ⌘K
    // command palette can read conversations/users/people on every page.
    <ChatProvider selfId={user.id}>
     <MobileNavProvider>
      <div className="flex min-h-[100dvh]">
        <ThemeSync initial={pref?.themePreference ?? null} />
        <AccentSync initial={pref?.accentPreference ?? null} />
        <style>{`:root{--accent:${org.accentColor}}`}</style>
        <MobileNavDrawer>
          <Sidebar
            org={{ name: org.name, logoPath: org.logoPath }}
            user={{ id: user.id, name: user.name, image: pref?.image ?? null }}
            unread={chatUnread}
            role={user.role}
            version={APP_VERSION}
          />
        </MobileNavDrawer>
        {/* Safe areas (viewportFit:'cover' in the root viewport export): the top
            inset clears the notch/status bar for the header, and <main>'s bottom
            padding clears the home indicator. Every env() term is 0 on a device
            without insets, so nothing about the desktop shell moves. */}
        <div id="app-content" className="flex min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)]">
          {/* Pinned at md+ (same reasoning as the rail): search, bell and the user
              menu stay reachable on a long page. Needs an opaque background — the
              header painted none and content would scroll under it. z-30 sits below
              the phone drawer (z-50) and ties the two fixed z-30 scrims, which mount
              later in the DOM and so paint over it; transient Menu popovers are z-40
              in the root stacking context and still paint over the header. On phones
              the header stays in flow — #app-content's pt-[env(safe-area-inset-top)]
              sits ABOVE it, so a phone-side sticky would need its own env() terms. */}
          <header className="flex h-12 items-center justify-between gap-2 border-b border-border bg-canvas px-3 md:sticky md:top-0 md:z-30 md:px-6">
            <BackButton />
            <MobileNavToggle />
            <div role="search" aria-label="Search" data-region-root tabIndex={-1} className="min-w-0 flex-1 outline-none">
              <CommandPalette orgName={org.name} role={user.role} />
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Bell soundsSeed={pref?.soundsEnabled ?? false} />
              <UserMenu user={{ id: user.id, name: user.name, image: pref?.image ?? null }} />
            </div>
          </header>
          <main data-region-root tabIndex={-1} className="flex-1 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none md:p-6 md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">{children}</main>
        </div>
      </div>
      {/* Global create-issue composer + `c` shortcut — mounted once so any page
          (or the ⌘K palette) can raise the modal. Hotkey is role-gated. */}
      <CreateIssueModal users={issueUsers} projects={issueProjects} labels={issueLabels} currentUserId={user.id} />
      {/* Global project-update composer — same one-source option list, so a chat
          message's "Post as project update" can raise it from any page. */}
      <ProjectUpdateModal projects={issueProjects} />
      {/* Global "Give feedback" dialog — raised from the sidebar footer or the ⌘K
          palette on any page. Deliberately NOT role-gated: guests submit too. */}
      <FeedbackDialog version={APP_VERSION} />
      {/* Global chat-image viewer (wave-7) — raised by any message row's
          "View image" affordance; state is external (image-viewer-store) so the
          dialog survives the optimistic-temp → server-message row remount. */}
      <ImageViewerDialog />
      <IssueHotkeys role={user.role} />
      {/* Unread-chats "(N)" tab title — mounted once in the app shell (inside
          ChatProvider); same live derivation as the sidebar Chat badge. */}
      <ChatTitleBadge />
      {/* Registers the service worker (push + offline shell) on every load. */}
      <SwRegister />
      {/* Global toast host — mounted once so `toast()` works from any page. */}
      <ToastHost />
      {/* Accessibility: F6 region cycling + SSE live regions mounted at first
          paint so assistive tech registers them before any message arrives.
          #live-msgs receives genuinely-new inbound chat text (message-pane pushes
          it); #live-status carries transient connection/status announcements. */}
      <RegionCycler />
      <div id="live-msgs" role="log" aria-live="polite" aria-relevant="additions text" className="sr-only" />
      <div id="live-status" role="status" aria-live="polite" className="sr-only" />
     </MobileNavProvider>
    </ChatProvider>
  )
}
