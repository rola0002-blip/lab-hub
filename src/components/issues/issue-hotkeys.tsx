'use client'
import { useGlobalHotkey } from '@/components/hooks/use-global-hotkey'
import { openIssueComposer } from '@/lib/issue-composer-store'
import type { Role } from '@/lib/session'

export function IssueHotkeys({ role }: { role: Role }) {
  // `c` is a GLOBAL quick-capture shortcut (v0.9.5) — no pathname gate, so it
  // works on every app page, not just /issues and /projects. The three guards
  // that matter are preserved:
  //   1. Modifier guard — useGlobalHotkey's plain-key contract is BARE presses
  //      only: a `c` with Cmd/Ctrl/Alt held belongs to the browser (Ctrl+C copy),
  //      and the hook's preventDefault would have broken it, so the hook returns
  //      before preventDefault (Shift stays allowed — Shift+C is still a
  //      deliberate `c` press).
  //   2. Typing guard — useGlobalHotkey ignores `c` while focus is in an
  //      INPUT/TEXTAREA/SELECT/contenteditable (the chat textarea, the ⌘K input,
  //      the description mention box), so it never fires mid-typing.
  //   3. Modal guard (below) — never fire while any modal is open: focus traps
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
