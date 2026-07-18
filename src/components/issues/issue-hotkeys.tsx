'use client'
import { usePathname } from 'next/navigation'
import { useGlobalHotkey } from '@/components/hooks/use-global-hotkey'
import { openIssueComposer } from '@/lib/issue-composer-store'
import type { Role } from '@/lib/session'

export function IssueHotkeys({ role }: { role: Role }) {
  const pathname = usePathname()
  const inProjects = pathname.startsWith('/issues') || pathname.startsWith('/projects')
  useGlobalHotkey('c', () => {
    // Never fire while any modal is open: focus traps keep focus INSIDE a
    // dialog but allow it on non-input elements (menu triggers, Cancel/Create
    // buttons), where the hook's input-tag guard doesn't apply — without this
    // check, `c` on a modal's button would stack the composer on top. The
    // selector covers every `Modal` consumer (project composer, delete
    // confirms, the create-issue modal itself) and the ⌘K palette — all
    // render role="dialog" aria-modal="true".
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
    if (role !== 'guest' && inProjects) openIssueComposer({ assignToSelf: true }) // quick capture → assign self
  })
  return null
}
