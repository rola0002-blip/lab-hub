'use client'
import { useEffect, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useGlobalHotkey } from '@/components/hooks/use-global-hotkey'
import { historyDepth } from '@/lib/history-depth-store'

// Top-bar Back control. It appears ONLY when at least one in-app history entry sits behind
// the current one, so pressing it can never leave the app: a cold deep link, a PWA launch
// (`manifest.ts` display: 'standalone') and an `sw.js` notification navigation all render
// nothing. The depth is stamped onto each history ENTRY — see `@/lib/history-depth` for why
// neither `history.length` nor a bare counter can answer the question, and
// `@/lib/history-depth-store` for how the stamp survives Next rewriting the entry.
//
// Visibility is READ FROM THE HISTORY STORE, not from a route-keyed effect: a push or a
// traversal that changes only the query (chat's search box deep-links to
// `/chat/<id>?msg=<n>`) leaves `usePathname()` equal, and a pathname-keyed effect would
// desync the control in both directions. Binding the store with useSyncExternalStore also
// means there is no setState in an effect at all.

export function BackButton() {
  const router = useRouter()
  const canBack = useSyncExternalStore(
    historyDepth.subscribe, historyDepth.getSnapshot,
    // Server + hydration: history is unreadable there, so nothing renders and the first
    // client paint matches. The effect below then seeds the real answer.
    historyDepth.getServerSnapshot,
  )

  useEffect(() => {
    // Mount-once. Every later change arrives through the instrumented mutators (which catch
    // every Next navigation, refresh and server action) or through popstate, so there is
    // nothing left for a route-keyed re-run to repair.
    historyDepth.install(window.history)
    historyDepth.sync(window.history)
    const onPop = (e: PopStateEvent) => historyDepth.adopt(e.state)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useGlobalHotkey('[', () => {
    // Modal guard, the issue-hotkeys.tsx:21 idiom: never fire while any dialog is open (a
    // focus trap allows focus on non-input elements, where useGlobalHotkey's typing guard
    // — itself skipped for meta chords — would not help).
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
    // Reads the live depth rather than a rendered value, so it can never act on a stale render.
    if (historyDepth.depth() > 0) router.back()
  }, { meta: true })

  if (!canBack) return null
  return (
    <button type="button" onClick={() => { if (historyDepth.depth() > 0) router.back() }} aria-label="Back"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
      <ArrowLeft size={18} aria-hidden />
    </button>
  )
}
