'use client'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Pin, MoreHorizontal } from 'lucide-react'
import { Menu } from '@/components/ui/menu'
import { toast } from '@/lib/toast-store'
import { pinProjectAction, unpinProjectAction } from '@/app/(app)/issues/actions'

type Pinned = { id: string; name: string; openCount: number }

// Pinned-project chips above the filter bar on /issues/me (F3). A chip click
// filters via the existing ?project= machinery — no new filter code. All roles
// (guests included); the pin list is per-user state, never shared.
export function PinnedProjects({ pinned, projects, activeId }: {
  pinned: Pinned[]; projects: { id: string; name: string }[]; activeId: string | null
}) {
  const router = useRouter()
  const [, start] = useTransition()
  const pinnedIds = new Set(pinned.map((p) => p.id))
  // Nothing to show and nothing to manage (a bare org, before any project exists)
  // — the row is omitted entirely rather than rendering an empty labelled group.
  if (pinned.length === 0 && projects.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Pinned projects">
      {pinned.map((p) => (
        <span key={p.id}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
            p.id === activeId
              ? 'border-[var(--border-focus)] bg-selected font-semibold text-[var(--text-accent)]'
              : 'border-border text-default hover:bg-hover'
          }`}>
          <Pin size={11} aria-hidden />
          <Link href={`/issues/me?project=${p.id}`} aria-current={p.id === activeId ? 'true' : undefined}
            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">{p.name}</Link>
          {p.openCount > 0 && <span className="text-subtle">{p.openCount}</span>}
        </span>
      ))}
      {projects.length > 0 && (
        <Menu label="Manage pinned projects" button={<MoreHorizontal size={14} aria-hidden />} items={projects.map((p) => ({
          label: pinnedIds.has(p.id) ? `Unpin ${p.name}` : `Pin ${p.name}`,
          onSelect: () => start(async () => {
            const r = pinnedIds.has(p.id) ? await unpinProjectAction(p.id) : await pinProjectAction(p.id)
            if (!r.ok) toast(r.message) // e.g. the MAX_PINS cap surfaced from the service's PolicyError
            router.refresh()
          }),
        }))} />
      )}
    </div>
  )
}
