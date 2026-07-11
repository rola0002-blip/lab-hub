'use client'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { Check } from 'lucide-react'
import { ACCENTS, DEFAULT_ACCENT, isAccentSlug, type AccentSlug } from '@/lib/accents'
import { nextRovingIndex } from '@/lib/roving'

type Theme = 'light' | 'dark'

// The <html> attributes are the source of truth (set pre-paint by the boot
// script). Subscribe to them — React-19 external-store pattern, so no
// setState-in-effect (the repo's react-hooks/set-state-in-effect lint).
function subscribeAttr(onChange: () => void) {
  const o = new MutationObserver(onChange)
  o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] })
  return () => o.disconnect()
}
function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}
function getAccentSnapshot(): AccentSlug {
  const a = document.documentElement.dataset.accent
  return isAccentSlug(a) ? a : DEFAULT_ACCENT
}

export function AccentPicker() {
  const theme = useSyncExternalStore(subscribeAttr, getThemeSnapshot, () => 'light' as Theme)
  const current = useSyncExternalStore(subscribeAttr, getAccentSnapshot, () => DEFAULT_ACCENT)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])

  const pick = useCallback((slug: AccentSlug) => {
    document.documentElement.dataset.accent = slug
    try { localStorage.setItem('accent', slug) } catch {}
    // Fire-and-forget: follows the user across devices. Failure is ignored —
    // localStorage already applied it on this device.
    fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accentPreference: slug }),
    }).catch(() => {})
  }, [])

  function onKeyDown(e: React.KeyboardEvent) {
    const k = e.key
    if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'Home' && k !== 'End') return
    e.preventDefault()
    const i = ACCENTS.findIndex((a) => a.slug === current)
    // Map horizontal arrows onto the roving helper's vertical vocabulary.
    const key = k === 'ArrowLeft' ? 'ArrowUp' : k === 'ArrowRight' ? 'ArrowDown' : k
    const next = nextRovingIndex(i < 0 ? 0 : i, ACCENTS.length, key as Parameters<typeof nextRovingIndex>[2])
    pick(ACCENTS[next]!.slug)
    btnRefs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label="Accent color" onKeyDown={onKeyDown} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {ACCENTS.map((a, i) => {
        const selected = a.slug === current
        const swatch = theme === 'dark' ? a.dark : a.light
        return (
          <button
            key={a.slug}
            ref={(el) => { btnRefs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            title={a.name}
            onClick={() => pick(a.slug)}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm ${
              selected
                ? 'border-[var(--ring-focus)] text-default ring-2 ring-[var(--ring-focus)] ring-offset-1 ring-offset-[var(--bg-canvas)]'
                : 'border-border text-muted hover:border-border-strong'
            }`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-avatar)]" style={{ background: swatch }}>
              {selected && <Check size={13} className="text-white" aria-hidden />}
            </span>
            <span className="truncate">{a.name}</span>
          </button>
        )
      })}
    </div>
  )
}

// Mirrors ThemeSync: applies the account's saved accent on this device only when
// the device has no local choice yet (localStorage wins on the device). Writes
// only DOM/localStorage — no setState — so it is clean under
// react-hooks/set-state-in-effect. Mounted in the app shell beside <ThemeSync/>.
export function AccentSync({ initial }: { initial: string | null }) {
  useEffect(() => {
    try {
      if (!localStorage.getItem('accent') && isAccentSlug(initial)) {
        document.documentElement.dataset.accent = initial
        localStorage.setItem('accent', initial)
      }
    } catch {}
  }, [initial])
  return null
}
