'use client'
import { useSyncExternalStore } from 'react'
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
