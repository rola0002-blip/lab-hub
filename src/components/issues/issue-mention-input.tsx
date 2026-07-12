'use client'
import { useId, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { mentionQueryAt, insertMention, moveActive } from '@/features/issues/mention-input'

type Opt = { id: string; name: string; image?: string | null }
export function IssueMentionInput({ value, onChange, users, placeholder, rows = 3, ariaLabel }: {
  value: string; onChange: (v: string) => void; users: Opt[]; placeholder?: string; rows?: number; ariaLabel: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const matches = query === null ? [] : users.filter((u) => u.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)
  const open = matches.length > 0
  const activeIdx = Math.min(active, matches.length - 1) // clamp when the match list shrinks
  const listId = useId()
  const optId = (i: number) => `${listId}-opt-${i}`

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    onChange(v)
    setQuery(mentionQueryAt(v, e.target.selectionStart ?? v.length))
    setActive(0) // reset the active option whenever the query changes (event handler, not an effect)
  }
  function pick(u: Opt) {
    const el = ref.current!
    const { value: next, caret } = insertMention(value, el.selectionStart ?? value.length, u.id)
    onChange(next); setQuery(null); setActive(0)
    // Value is controlled, so the DOM caret settles after this handler returns:
    // restore focus + caret just past the inserted token on the next frame.
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret) })
  }
  // Keyboard operability (WCAG 2.1.1): while the listbox is open, the textarea owns
  // navigation via aria-activedescendant — ArrowUp/Down move, Enter/Tab pick, Escape
  // dismisses. Mirrors the chat composer's proven pattern.
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const key = e.key; e.preventDefault(); setActive((i) => moveActive(i, key, matches.length)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[activeIdx]) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuery(null) }
  }
  return (
    <div className="relative">
      <textarea ref={ref} value={value} onChange={onInput} onKeyDown={onKeyDown} rows={rows} placeholder={placeholder} aria-label={ariaLabel}
        role="combobox" aria-autocomplete="list" aria-expanded={open}
        aria-controls={open ? listId : undefined} aria-activedescendant={open ? optId(activeIdx) : undefined}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
      {open && (
        <ul id={listId} role="listbox" aria-label="Mention a person" className="absolute z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-1 shadow-menu">
          {matches.map((u, i) => (
            <li key={u.id} id={optId(i)} role="option" aria-selected={i === activeIdx}>
              {/* Pointer selection: onMouseDown preventDefault keeps the textarea
                  focused (so the caret survives) and onClick does the insert — a
                  single pick per click. Options are not tab stops; the textarea
                  drives keyboard selection via aria-activedescendant above. */}
              <button type="button" tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(u)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] ${i === activeIdx ? 'bg-hover' : 'hover:bg-hover'}`}>
                <Avatar size={20} name={u.name} id={u.id} image={u.image} /><span className="truncate">{u.name}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  )
}
