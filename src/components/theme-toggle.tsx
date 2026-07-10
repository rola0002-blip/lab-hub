'use client'
import { useEffect, useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

type Theme = 'light' | 'dark'

// The source of truth is the DOM's data-theme attribute (set pre-paint by the
// boot script in the root layout). Subscribe to it instead of mirroring into
// React state inside an effect — this is the React 19 external-store pattern.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}
function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}
function getServerSnapshot(): Theme {
  return 'light'
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('theme', next) } catch {}
    // Fire-and-forget: persist the choice server-side so it follows the user to
    // other devices. Failures are ignored — localStorage already applied it here.
    fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ themePreference: next }),
    }).catch(() => {})
  }
  return (
    <button
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-default"
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  )
}

// Applies the user's saved server-side theme on this device, but only when the
// device has no local choice yet — localStorage always wins on the device.
// This runs after the pre-paint boot script; when localStorage is empty the
// boot script has already fallen back to the OS preference, so writing the
// saved preference here corrects it to the user's account choice. The effect
// only writes to the DOM/localStorage (no setState), so it stays clean under
// the repo's react-hooks/set-state-in-effect rule.
export function ThemeSync({ initial }: { initial: string | null }) {
  useEffect(() => {
    try {
      if (!localStorage.getItem('theme') && (initial === 'dark' || initial === 'light')) {
        document.documentElement.dataset.theme = initial
        localStorage.setItem('theme', initial)
      }
    } catch {}
  }, [initial])
  return null
}
