'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ChevronDown, LayoutDashboard, MessageCircle, CalendarDays, CalendarCheck,
  ClipboardCheck, Award, Users, Microscope, Settings, ListTodo, Inbox,
  FolderKanban, Files, Megaphone, type LucideIcon,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Menu } from '@/components/ui/menu'
import { useChat } from '@/components/chat/chat-store'
import { sumUnread } from '@/features/chat/unread'
import { authClient } from '@/lib/auth-client'
import { openFeedbackComposer } from '@/lib/feedback-composer-store'
import { isNavItemActive } from '@/lib/nav-active'
import type { Role } from '@/lib/session'

export type NavItem = { href: string; label: string; icon: LucideIcon }

// Full, static nav map (grouped). Task 16's ⌘K palette imports this verbatim, so
// the shape and export name are contract. Hrefs match the real App Router routes
// (admin pages live under /admin/*). Per-role visibility is applied at render.
export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  { title: 'Workspace', items: [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/chat', label: 'Chat', icon: MessageCircle },
    { href: '/files', label: 'Files', icon: Files },
    // All roles, deliberately absent from NON_GUEST/ADMIN_ONLY: /feedback is
    // role-adaptive, not role-gated (a guest sees their own submissions there).
    { href: '/feedback', label: 'Feedback', icon: Megaphone },
  ] },
  { title: 'Projects', items: [
    { href: '/issues/me', label: 'My issues', icon: Inbox },
    { href: '/issues', label: 'Issues', icon: ListTodo },
    { href: '/projects', label: 'Projects', icon: FolderKanban },
  ] },
  { title: 'Lab', items: [
    { href: '/booking', label: 'Booking', icon: CalendarDays },
    { href: '/bookings', label: 'My bookings', icon: CalendarCheck },
    { href: '/approvals', label: 'Approvals', icon: ClipboardCheck },
    { href: '/certifications', label: 'Certifications', icon: Award },
  ] },
  { title: 'Directory', items: [{ href: '/people', label: 'People', icon: Users }] },
  { title: 'Admin', items: [
    { href: '/admin/equipment', label: 'Equipment', icon: Microscope },
    { href: '/admin/settings', label: 'Settings', icon: Settings },
  ] },
]

// Role gating mirrors the server-side nav filtering (app)/layout.tsx applied
// before this component owned the rail: guests get only the always-on rows,
// members add the directory/workflow rows, admins add the admin rows.
const NON_GUEST = new Set(['/approvals', '/people', '/certifications'])
const ADMIN_ONLY = new Set(['/admin/equipment', '/admin/settings'])
// Single source of truth for per-role nav visibility. The ⌘K command palette
// (command-palette.tsx) imports this so its page destinations are gated
// identically to the rail — a guest is never offered Admin/People rows anywhere.
export function isNavVisible(href: string, role: Role): boolean {
  if (ADMIN_ONLY.has(href)) return role === 'admin'
  if (NON_GUEST.has(href)) return role !== 'guest'
  return true
}

export function Sidebar({ org, user, unread, role, version }: {
  org: { name: string; logoPath: string | null }
  user: { id: string; name: string; image: string | null }
  unread: number
  role: Role
  version: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  // v0.11 §3.1: the `unread` prop is a SERVER value computed once in (app)/layout.tsx,
  // and the App Router preserves that layout segment across every client navigation —
  // so it never changes for the life of the SPA session, and reading a conversation
  // left the badge stale. Derive it from the live chat store instead. Sidebar is already
  // a client component, and it already sits inside ChatProvider (layout.tsx:41), so this
  // costs no provider hoisting and no extra subscription.
  const { conversations } = useChat()
  // The SSR seed holds until the store's first fetch lands, so the badge never flashes
  // 0 on hydration and degrades to the server value if the fetch fails (chat-store.tsx:44-46
  // leaves `conversations` empty on a non-ok response). `length > 0` is the loaded flag
  // rather than a new store field, and it is provably safe: totalUnread returns 0 for a
  // user with no memberships, so both branches coincide in the only ambiguous case.
  const live = conversations.length > 0 ? sumUnread(conversations) : unread
  // Flat href list feeds the longest-prefix-wins active test (all sections,
  // regardless of role visibility, so activeness is stable across roles).
  const allHrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href))
  // Reuse the existing better-auth sign-out mechanism (was <SignOutButton/>).
  // Also drop this device's saved theme/accent so a shared machine never leaks
  // the previous user's appearance to the next (and their own server prefs win).
  async function handleSignOut() {
    await authClient.signOut()
    try { localStorage.removeItem('theme'); localStorage.removeItem('accent') } catch {}
    router.push('/sign-in')
  }

  return (
    <div className="flex w-56 shrink-0 flex-col bg-sidebar p-2">
      <Menu
        label="Workspace menu"
        buttonClassName="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sidebar-fg-strong hover:bg-sidebar-hover"
        button={
          <>
            {org.logoPath ? (
              // eslint-disable-next-line @next/next/no-img-element -- uploads are served by our own route
              <img src={org.logoPath} alt="" className="h-6 w-6 rounded-md object-cover" />
            ) : (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-2xs font-black text-accent-on">{org.name[0]}</span>
            )}
            <span className="truncate text-md font-semibold">{org.name}</span>
            <ChevronDown size={14} className="ml-auto shrink-0 text-sidebar-muted" aria-hidden />
          </>
        }
        items={[{ label: 'Sign out', onSelect: handleSignOut }]}
      />
      <nav aria-label="Primary" data-region-root tabIndex={-1} className="mt-2 flex-1 overflow-y-auto outline-none">
        {NAV_SECTIONS.map((sec) => {
          const items = sec.items.filter((i) => isNavVisible(i.href, role))
          if (items.length === 0) return null
          return (
            <div key={sec.title}>
              <p className="px-2 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wide text-sidebar-muted">{sec.title}</p>
              <ul>
                {items.map(({ href, label, icon: Icon }) => {
                  const active = isNavItemActive(pathname, href, allHrefs)
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={`flex h-7 items-center gap-2 rounded-md px-2 text-sm ${
                          active
                            ? 'bg-sidebar-active font-semibold text-white'
                            : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-sidebar-fg-strong'
                        }`}
                      >
                        <Icon size={15} aria-hidden />
                        <span className="truncate">{label}</span>
                        {label === 'Chat' && <Badge count={live} />}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>
      <div className="flex flex-col gap-1 border-t border-[var(--sidebar-border)] px-1 pt-2">
        <div className="flex items-center gap-2">
          <Avatar name={user.name} id={user.id} image={user.image} size={24} presence="active" />
          <span className="truncate text-sm text-sidebar-fg">{user.name}</span>
        </div>
        {/* Rail tokens only — never accent (the --sidebar-* family is not accent-themed);
            the focus ring is the global :focus-visible outline, as for every other rail
            control. The path is captured at click time so the submission records the page
            the user was actually on. */}
        <button
          type="button"
          data-close-nav
          onClick={() => openFeedbackComposer(window.location.pathname + window.location.search)}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-sm text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg-strong active:bg-sidebar-hover"
        >
          <Megaphone size={15} aria-hidden />
          <span className="truncate">Give feedback</span>
        </button>
        <span className="px-0.5 text-2xs text-sidebar-muted">v{version}</span>
      </div>
    </div>
  )
}
