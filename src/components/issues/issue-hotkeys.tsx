'use client'
import { useGlobalHotkey } from '@/components/hooks/use-global-hotkey'
import { openIssueComposer } from '@/lib/issue-composer-store'
import type { Role } from '@/lib/session'

export function IssueHotkeys({ role }: { role: Role }) {
  // `c` is a GLOBAL quick-capture shortcut (v0.9.5) — no pathname gate, so it
  // works on every app page, not just /issues and /projects. The two guards that
  // matter are preserved:
  //   1. Typing guard — useGlobalHotkey ignores `c` while focus is in an
  //      INPUT/TEXTAREA/contenteditable (the chat textarea, the ⌘K input, the
  //      description mention box), so it never fires mid-typing.
  //   2. Modal guard (below) — never fire while any modal is open: focus traps
  //      keep focus INSIDE a dialog but allow it on non-input elements (menu
  //      triggers, Cancel/Create buttons), where the typing guard doesn't apply;
  //      without this, `c` on a modal's button would stack the composer on top.
  //      The selector covers every `Modal` consumer (project composer, delete
  //      confirms, the create-issue modal itself) and the ⌘K palette — all render
  //      role="dialog" aria-modal="true".
  useGlobalHotkey('c', () => {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
    if (role !== 'guest') openIssueComposer({ assignToSelf: true }) // quick capture → assign self
  })
  return null
}
