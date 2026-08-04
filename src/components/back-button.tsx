'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useGlobalHotkey } from '@/components/hooks/use-global-hotkey'
import { nextDepth, stampDepth, type DepthState, type NavKind } from '@/lib/history-depth'

// Top-bar Back control. It appears ONLY when at least one in-app history entry sits
// behind the current one, so pressing it can never leave the app: a cold deep link, a PWA
// launch (`manifest.ts` display: 'standalone') and an `sw.js` notification navigation all
// render nothing. The depth is stamped onto each history ENTRY — see `@/lib/history-depth`
// for why neither `history.length` nor a bare counter can answer the question.

// Module scope, deliberately outside React: `seeded` distinguishes the entry this document
// loaded on (depth 0) from entries created by in-app navigation, and both reset on a
// genuine full page load — which is exactly when the module re-evaluates.
let current: DepthState = { depth: 0, seeded: false }
let instrumented = false

function advance(kind: NavKind, state: unknown) {
  const r = nextDepth(current, kind, state)
  current = { depth: r.depth, seeded: r.seeded }
  return r
}

// Stamp at the mutation boundary, once per document. Next's HistoryUpdater re-writes the
// CURRENT entry with its own bare state — no spread of what is already there — for every
// `router.replace`, `router.refresh`, server action and query-only filter update
// (`preserveCustomHistoryState` is true only for the initial state and for traversals).
// Left alone that silently strips the stamp, and the entry then reads as brand new the
// next time the user comes back to it: the depth inflates and the control eventually
// offers a Back that exits the app. Wrapping the two mutators keeps the invariant the
// visibility rule needs — only a push deepens history — which is also what makes the
// post-delete `router.replace` (issue-detail.tsx) keep the depth of the entry it
// overwrote, so Back lands on the entry BEFORE the deleted one, never on the deleted one.
function instrument() {
  if (instrumented) return
  instrumented = true
  // Bound before assignment, so these stay the underlying implementations. Next patches
  // the same two methods in an app-router effect; child effects run first, so Next
  // captures these wrappers as its own "originals" and delegates to them (its patch
  // short-circuits on `__NA`, which every Next-written state carries). Deliberately never
  // uninstalled: the control lives in the app shell for the life of the document, and a
  // second instrument() is a no-op.
  const push = window.history.pushState.bind(window.history)
  const replace = window.history.replaceState.bind(window.history)
  window.history.pushState = (data: unknown, unused: string, url?: string | URL | null) =>
    push(stampDepth(data, advance('push', data).depth), unused, url)
  window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) =>
    replace(stampDepth(data, advance('replace', data).depth), unused, url)
}

export function BackButton() {
  const router = useRouter()
  const pathname = usePathname()
  const [canBack, setCanBack] = useState(false)   // false on the server and at first paint

  useEffect(() => {
    instrument()
    const st = window.history.state
    const r = advance('restore', st)
    // Spread-preserve Next's own history state (it keys popstate off it); never replace
    // it with a bare object.
    if (r.write) window.history.replaceState(stampDepth(st, r.depth), '')
    // react-hooks/set-state-in-effect is enforced in this repo (chat-store.tsx:49-51
    // precedent). This setState is unavoidable and correct: the value derives from
    // window.history, which cannot be read during render on the server, and this effect
    // additionally WRITES the stamp. The derive-during-render idiom used by
    // MobileNavProvider (mobile-nav.tsx:26-36) does not apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanBack(r.depth > 0)
  }, [pathname])

  useGlobalHotkey('[', () => {
    // Modal guard, the issue-hotkeys.tsx:21 idiom: never fire while any dialog is open (a
    // focus trap allows focus on non-input elements, where useGlobalHotkey's typing guard
    // — itself skipped for meta chords — would not help).
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
    // Reads `current` directly rather than `canBack`, so it can never act on a stale render.
    if (current.depth > 0) router.back()
  }, { meta: true })

  if (!canBack) return null
  return (
    <button type="button" onClick={() => { if (current.depth > 0) router.back() }} aria-label="Back"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
      <ArrowLeft size={18} aria-hidden />
    </button>
  )
}
