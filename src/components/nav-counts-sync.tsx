'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { refreshNavCounts } from '@/lib/nav-counts-store'
import { useEvents } from './use-events'

// W20-D: the ONE place the sidebar pending counts refetch — mounted once in the
// app shell for non-guests (the ChatTitleBadge posture), NEVER inside Sidebar
// (which mounts twice while the phone drawer is open). Triggers: mount + every
// navigation, a `notif`/`reconnect` SSE event (a new booking or training request
// notifies every decider — each instrument's managers plus every admin, exactly
// the set the counts cover), the window regaining focus or visibility, and a 60 s
// poll — the backstop for a decision made by ANOTHER manager, which notifies only
// the requester (deliberately NO new LabEvent member). A decider's own
// approve/grant refreshes at once (approvals-client / requests call refreshNavCounts).
export function NavCountsSync() {
  const pathname = usePathname()
  useEffect(() => { void refreshNavCounts() }, [pathname])
  useEffect(() => {
    const refresh = () => { void refreshNavCounts() }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    const t = setInterval(refresh, 60_000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(t)
    }
  }, [])
  // useEvents re-reads this closure every render (ref'd handler), so no
  // useCallback is needed; the hook shares the tab's one EventSource.
  useEvents((e) => { if (e.t === 'notif' || e.t === 'reconnect') void refreshNavCounts() })
  return null
}
