'use client'
import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useMediaQuery } from '@/components/hooks/use-media-query'
import { useVisualViewportHeight } from '@/components/hooks/use-visual-viewport'

// Responsive chat shell. At md+ (≥768) it is byte-identical to the previous
// static layout: a fixed w-64 conversation-list rail beside the flex-1 message
// pane. Below md it becomes a Slack-style list/pane SWAP so there is never a
// second shrink-0 column forcing horizontal scroll at 320px:
//   • no conversation selected (/chat)      → list full-width, pane hidden
//   • a conversation open   (/chat/<cid>)    → pane full-width, list hidden
// The pane carries its own "Back to conversations" control (message-pane header,
// md:hidden) to return to the list. usePathname re-renders this client component
// on navigation, so the swap tracks the selected conversation.
export function ChatShell({ list, children }: { list: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname()
  const hasConversation = /^\/chat\/.+/.test(pathname)
  const narrow = useMediaQuery('(max-width: 767px)')
  const vvh = useVisualViewportHeight()
  const ref = useRef<HTMLDivElement>(null)

  // Keyboard branch (phones only). iOS leaves the LAYOUT viewport — and therefore
  // 100dvh — at full height when the software keyboard opens, so the composer at
  // the bottom of the calc'd pane ends up under the keys. When
  // useVisualViewportHeight reports a keyboard, pin the pane to what is left of
  // the VISUAL viewport: from its own MEASURED top (the safe-area inset above has
  // already displaced it — the chrome arithmetic in the className below must
  // never be assumed here) down to the visual bottom, less the 1rem that
  // <main>'s p-4 contributes underneath (the keyboard covers the
  // home-indicator inset, so no env() term).
  // Written straight onto the node: the div carries no `style` prop, so React
  // never fights the assignment and this stays clear of setState-in-effect.
  // Removing the property hands the height back to the Tailwind calc.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!narrow || !vvh) { el.style.removeProperty('height'); return }
    el.style.height = `${Math.max(0, Math.round(vvh - el.getBoundingClientRect().top - 16))}px`
  }, [narrow, vvh])

  // Files dropped outside [data-chat-pane] (thread panel, rail, chat chrome) would
  // hit the browser default — the tab navigates to the dropped file and drafts are
  // lost. preventDefault (no stopPropagation) for FILE drags only; the pane's own
  // handlers run first on real targets, and text/URL drags keep their native
  // insert behaviour.
  useEffect(() => {
    const prevent = (e: DragEvent) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent) }
  }, [])

  return (
    // Height = viewport minus the app chrome ABOVE and BELOW this pane
    // ((app)/layout.tsx): the header via the --app-header-h token defined in
    // globals.css (the header's own height; change it there), plus <main>'s
    // padding — p-4 → 2×1rem below md, p-6 → 2×1.5rem at md+ (one flat 7rem
    // over-subtraction used to cover both). The env() terms are that same
    // layout's safe-area padding — #app-content's pt-[env(safe-area-inset-top)]
    // and <main>'s pb-[calc(1rem+env(…-bottom))] — which are 0 everywhere
    // except the notched standalone PWA, exactly where dropping them would
    // overrun the screen. Keep every term accounted for.
    <div
      ref={ref}
      className="flex h-[calc(100dvh-var(--app-header-h)-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] gap-0 overflow-hidden rounded-xl border border-border md:h-[calc(100dvh-var(--app-header-h)-3rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]"
    >
      <aside
        aria-label="Conversations"
        className={`${hasConversation ? 'hidden' : 'flex w-full'} flex-col border-r border-border md:flex md:w-64 md:shrink-0`}
      >
        {list}
      </aside>
      <div className={`${hasConversation ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col md:flex`}>{children}</div>
    </div>
  )
}
