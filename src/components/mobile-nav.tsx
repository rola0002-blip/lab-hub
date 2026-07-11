'use client'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
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
  // Trap focus in the drawer while open; the hook also restores focus to the
  // hamburger on close (its prev?.focus() cleanup).
  useFocusTrap(ref, open)

  // Esc closes; the rest of the shell goes inert so nothing behind the drawer is
  // reachable by pointer or assistive tech. Guarded on `open` so desktop (where
  // the drawer never opens) pays nothing.
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
            className="absolute inset-y-0 left-0 flex max-w-[85vw] shadow-modal"
          >
            {children}
          </div>
        </div>
      )}
    </>
  )
}
