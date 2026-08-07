'use client'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu as MenuIcon } from 'lucide-react'
import { useFocusTrap } from '@/components/hooks/use-focus-trap'

// Responsive primary-nav drawer. On md+ the sidebar is a static column
// (`md:contents` makes the wrapper vanish from layout, so the desktop shell is
// unchanged). Below md the column is hidden and a hamburger in the top bar opens
// the same sidebar as a focus-trapped, backdrop/Esc-dismissable drawer with the
// rest of the shell marked `inert`. State is shared via context so the toggle
// (header) and the drawer (nav slot) stay in sync.

const DRAWER_ID = 'mobile-nav-drawer'
const Ctx = createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null)

function useNav() {
  const c = useContext(Ctx)
  if (!c) throw new Error('MobileNav components must be used within <MobileNavProvider>')
  return c
}

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  // Auto-dismiss on navigation, derived during render (the idiomatic replacement for a
  // setState-in-effect — react-hooks/set-state-in-effect): when the route changes, a nav
  // <Link>, the ⌘K palette, or any programmatic push flips the pathname, so the drawer
  // closes itself — running its inert/focus cleanup — instead of staying open over the
  // page just navigated to (and leaving the shell stuck `inert`). React re-renders
  // immediately with the corrected state, so nothing paints the stale-open drawer.
  const [lastPath, setLastPath] = useState(pathname)
  if (pathname !== lastPath) {
    setLastPath(pathname)
    if (open) setOpen(false)
  }
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>
}

export function MobileNavToggle() {
  const { open, setOpen } = useNav()
  return (
    <button
      type="button" aria-label="Open navigation" aria-expanded={open} aria-controls={DRAWER_ID}
      onClick={() => setOpen(true)}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-default md:hidden"
    >
      <MenuIcon size={18} aria-hidden />
    </button>
  )
}

export function MobileNavDrawer({ children }: { children: React.ReactNode }) {
  const { open, setOpen } = useNav()
  const ref = useRef<HTMLDivElement>(null)

  // Esc closes; the rest of the shell goes inert so nothing behind the drawer is
  // reachable by pointer or assistive tech. Guarded on `open` so desktop (where
  // the drawer never opens) pays nothing.
  //
  // DECLARATION ORDER IS LOAD-BEARING: this effect is declared BEFORE
  // useFocusTrap so React runs cleanups in declaration order on close — `inert`
  // is cleared HERE first, and only then does the focus-trap cleanup below run
  // its prev?.focus(). The hamburger toggle lives inside #app-content, so
  // restoring focus to it while the content is still inert is a silent no-op
  // (focus falls to <body>) — the bug this ordering fixes.
  useEffect(() => {
    if (!open) return
    const content = document.getElementById('app-content')
    content?.setAttribute('inert', '')
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      content?.removeAttribute('inert')
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  // Trap focus in the drawer while open. On close the hook's prev?.focus()
  // cleanup restores focus to the hamburger toggle — which lands only because the
  // inert effect above (declared first) has already cleared `inert` by the time
  // this cleanup runs.
  useFocusTrap(ref, open)

  return (
    <>
      {/* md+: static column (display:contents → wrapper disappears, sidebar sits
          directly in the shell flex row, exactly as before). <md: hidden. */}
      <div className="hidden md:contents">{children}</div>
      {/* Mobile drawer, only mounted while open. */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button" aria-hidden tabIndex={-1} onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div
            ref={ref} id={DRAWER_ID} role="dialog" aria-modal="true" aria-label="Navigation"
            // Safe-area padding: the drawer is `fixed inset-0`, so with
            // viewportFit:'cover' it spans under the notch and the left rounded
            // corner in landscape. Both env() terms are 0 elsewhere.
            className="absolute inset-y-0 left-0 flex max-w-[85vw] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] shadow-modal"
            // Close on any nav-link tap. The pathname effect already covers route changes;
            // this also dismisses when the tapped item is the CURRENT route (no pathname
            // change to react to). Scoped to <a> so the workspace menu / sign-out buttons
            // inside the rail don't trip it — plus an explicit opt-in attribute for the rail
            // buttons that DO need it: "Give feedback" raises a modal with its own focus
            // trap, and leaving the drawer's trap alive underneath breaks both.
            onClick={(e) => { if ((e.target as HTMLElement).closest('a,[data-close-nav]')) setOpen(false) }}
          >
            {children}
          </div>
        </div>
      )}
    </>
  )
}
