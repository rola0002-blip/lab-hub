'use client'
import { useRef, useState } from 'react'
import { Avatar } from '@/components/ui/avatar'

type Opt = { id: string; name: string; image?: string | null }
export function IssueMentionInput({ value, onChange, users, placeholder, rows = 3, ariaLabel }: {
  value: string; onChange: (v: string) => void; users: Opt[]; placeholder?: string; rows?: number; ariaLabel: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<string | null>(null)
  const matches = query === null ? [] : users.filter((u) => u.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    onChange(v)
    const upto = v.slice(0, e.target.selectionStart ?? v.length)
    const m = /@([\w-]*)$/.exec(upto)
    setQuery(m ? m[1] : null)
  }
  function pick(u: Opt) {
    const el = ref.current!; const caret = el.selectionStart ?? value.length
    const before = value.slice(0, caret).replace(/@([\w-]*)$/, `<@${u.id}> `)
    onChange(before + value.slice(caret)); setQuery(null); el.focus()
  }
  return (
    <div className="relative">
      <textarea ref={ref} value={value} onChange={onInput} rows={rows} placeholder={placeholder} aria-label={ariaLabel}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
      {matches.length > 0 && (
        <ul role="listbox" aria-label="Mention a person" className="absolute z-30 mt-1 w-56 rounded-lg border border-border bg-surface p-1 shadow-menu">
          {matches.map((u) => (
            <li key={u.id}><button type="button" onMouseDown={(e) => { e.preventDefault(); pick(u) }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
              <Avatar size={20} name={u.name} id={u.id} image={u.image} /><span className="truncate">{u.name}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  )
}
