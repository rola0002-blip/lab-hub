'use client'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { searchEmoji } from '@/features/chat/emoji'

// Shared, searchable emoji popover. Reused by the message hover toolbar, the
// reaction "+" chip, and (Task 14) the composer. It owns NO reaction/network
// logic — it only surfaces glyphs and calls back `onPick`. The single source of
// emoji truth is `@/features/chat/emoji` (Task 11); this file never re-lists
// glyphs beyond the seeded "Frequently used" recents.

const RECENTS_KEY = 'labhub.emoji.recents'
// Sensible lab-chatter defaults so the first-ever open isn't an empty row.
const SEED = ['👍', '✅', '👀', '🎉', '🙏', '😄', '🔥', '❤️']
const MAX_RECENTS = 16

// Read the recents list from localStorage, tolerating absent/corrupt values.
// Called from a lazy `useState` initializer (never during SSR of an open picker
// — the picker only mounts on a client interaction), so `window` is defined.
function loadRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY)
    if (!raw) return SEED
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((g) => typeof g === 'string')) {
      return parsed as string[]
    }
  } catch { /* unreadable / private-mode / corrupt — fall through to the seed */ }
  return SEED
}

// Most-recent-first, de-duplicated, capped. Persists best-effort (quota/denied
// writes are swallowed — recents are a convenience, never load-bearing).
function pushRecent(glyph: string): string[] {
  const next = [glyph, ...loadRecents().filter((g) => g !== glyph)].slice(0, MAX_RECENTS)
  try { window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}

export function EmojiPicker({ onPick, onClose, align = 'left' }: {
  onPick: (glyph: string) => void
  onClose: () => void
  // Horizontal anchor to the trigger: 'left' opens rightward (the "+" chip and
  // composer, on the left), 'right' opens leftward (the toolbar, on the right).
  align?: 'left' | 'right'
}) {
  const [query, setQuery] = useState('')
  const [recents, setRecents] = useState<string[]>(loadRecents)
  // The control that had focus when the picker opened. Captured in a lazy
  // initializer, which runs during render — BEFORE the search input's autoFocus
  // moves focus into the popover — so this is the trigger button, not the input.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null)

  // Restore focus to the opener when the picker closes (Escape, outside-click, or
  // a pick) — the popover analogue of use-focus-trap's `prev?.focus()`. A layout
  // cleanup runs during commit, before any consumer's rAF-based refocus, so a
  // composer that returns focus to its textarea after inserting still wins while a
  // reaction "+" chip or composer emoji button simply regains focus. focus() on a
  // now-hidden control is a silent no-op, so this never throws.
  useLayoutEffect(() => () => { opener?.focus() }, [opener])

  // Escape-to-close via a document listener (the shared Menu pattern). The effect
  // body only add/removes a listener — it never calls setState synchronously —
  // so `react-hooks/set-state-in-effect` stays satisfied.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const results = useMemo(() => searchEmoji(query), [query])
  const searching = query.trim() !== ''

  function pick(glyph: string) {
    setRecents(pushRecent(glyph))
    onPick(glyph)
  }

  const glyphBtn = 'flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none hover:bg-hover'

  return (
    <>
      {/* Full-viewport catcher: any outside click (including a second click on the
          trigger) closes the picker — sidesteps the trigger double-toggle. It sits
          below the panel (z-30 < z-40) so panel clicks aren't intercepted. */}
      <button
        type="button" aria-hidden tabIndex={-1} onMouseDown={onClose}
        className="fixed inset-0 z-30 cursor-default"
      />
      <div
        role="dialog" aria-label="Emoji picker"
        className={`absolute top-full ${align === 'right' ? 'right-0' : 'left-0'} z-40 mt-1 w-64 rounded-lg border border-border bg-surface p-2 shadow-menu`}
      >
        <input
          autoFocus type="text" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji…" aria-label="Search emoji"
          className="mb-2 w-full rounded-md border border-border bg-surface px-2 py-1 text-sm text-default placeholder:text-subtle focus:border-border-strong focus:outline-none"
        />

        {!searching && recents.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 px-0.5 text-2xs font-semibold uppercase tracking-wide text-subtle">Frequently used</p>
            <div className="flex flex-wrap gap-0.5">
              {recents.map((g) => (
                <button key={`recent-${g}`} type="button" aria-label={`react ${g}`} onClick={() => pick(g)} className={glyphBtn}>{g}</button>
              ))}
            </div>
          </div>
        )}

        <div className="max-h-48 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-0.5 py-2 text-xs text-subtle">No emoji found.</p>
          ) : (
            <div className="grid grid-cols-7 gap-0.5">
              {results.map(({ shortname, glyph }) => (
                <button
                  key={shortname} type="button" aria-label={shortname} title={`:${shortname}:`}
                  onClick={() => pick(glyph)} className={glyphBtn}
                >{glyph}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
