'use client'
import { useState, useTransition } from 'react'
import { createLabelAction } from '@/app/(app)/issues/actions'
import { LABEL_PALETTE } from '@/features/issues/status'
import { toast } from '@/lib/toast-store'

export type LabelOpt = { id: string; name: string; color: string }

export function LabelPicker({ labels, selectedIds, onChange, canEdit }: {
  labels: LabelOpt[]; selectedIds: string[]; onChange: (next: string[]) => void; canEdit: boolean
}) {
  const [query, setQuery] = useState('')
  const [pending, start] = useTransition()
  const q = query.trim()
  const visible = q ? labels.filter((l) => l.name.toLowerCase().includes(q.toLowerCase())) : labels
  const exact = labels.some((l) => l.name.toLowerCase() === q.toLowerCase())
  const selected = new Set(selectedIds)

  function toggle(id: string) {
    onChange(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])
  }
  function createAndSelect() {
    start(async () => {
      const color = LABEL_PALETTE[labels.length % LABEL_PALETTE.length]
      const r = await createLabelAction(q, color)
      if (r.ok) { setQuery(''); onChange([...selectedIds, r.data.id]) }
      else toast(r.message)
    })
  }
  return (
    <div>
      {canEdit && (
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter or create labels" placeholder="Filter or create…"
          className="mb-1 w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
      )}
      <div className="flex flex-wrap gap-1">
        {visible.map((l) => {
          const on = selected.has(l.id)
          return (
            <button key={l.id} type="button" disabled={!canEdit} aria-pressed={on} onClick={() => toggle(l.id)}
              className={`rounded-full px-2 py-0.5 text-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] ${on ? '' : 'opacity-50'}`}
              style={{ color: `var(${l.color})`, background: `color-mix(in srgb, var(${l.color}) 14%, var(--bg-canvas))` }}>{l.name}</button>
          )
        })}
        {canEdit && q && !exact && (
          <button type="button" disabled={pending} onClick={createAndSelect}
            className="rounded-full border border-dashed border-border px-2 py-0.5 text-2xs text-muted hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
            Create label “{q}”
          </button>
        )}
      </div>
    </div>
  )
}
