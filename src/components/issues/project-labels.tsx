'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Plus } from 'lucide-react'
import { Menu } from '@/components/ui/menu'
import { Modal } from '@/components/ui/modal'
import { createLabelAction, renameLabelAction, deleteLabelAction } from '@/app/(app)/issues/actions'
import { labelTextVar } from '@/features/issues/status'
import { toast } from '@/lib/toast-store'
import type { LabelDto } from '@/features/issues/issue-service'

const BTN = 'rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

// Shared add/rename dialog: a name field only — the color is minted server-side
// by cycling the fixed palette per scope count (spec §3.3).
function LabelDialog({ title, initial, pending, onClose, onSave }: {
  title: string; initial: string; pending: boolean; onClose: () => void; onSave: (name: string) => void
}) {
  const [name, setName] = useState(initial)
  return (
    <Modal title={title} onClose={onClose}>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus aria-label="Label name" placeholder="Label name"
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name) }}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
      <p className="mt-1 text-xs text-muted">Color follows the workspace palette automatically.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN}>Cancel</button>
        <button type="button" onClick={() => onSave(name)} disabled={!name.trim() || pending}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Save</button>
      </div>
    </Modal>
  )
}

// F5 — the project page's label management surface. Scoped list of ONE project's
// labels; the workspace-global set has no management UI yet (this is the first
// label UI). Guests get the read-only list with no affordances (issue-policy is
// the real gate; hiding the buttons keeps them from raising dialogs that 403).
export function ProjectLabels({ projectId, labels, canEdit }: { projectId: string; labels: LabelDto[]; canEdit: boolean }) {
  const router = useRouter()
  // One transition drives every mutation; its `pending` also disables the dialog
  // Save so a double-submit can't mint two labels from one draft.
  const [pending, start] = useTransition()
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<LabelDto | null>(null)
  const scoped = labels.filter((l) => l.projectId === projectId)
  function add(name: string) {
    start(async () => {
      const r = await createLabelAction(name, projectId)
      if (!r.ok) toast(r.message)
      else setAdding(false)
      router.refresh()
    })
  }
  function rename(labelId: string, name: string) {
    start(async () => {
      const r = await renameLabelAction(labelId, name)
      if (!r.ok) toast(r.message)
      else setRenaming(null)
      router.refresh()
    })
  }
  function del(labelId: string) {
    start(async () => {
      const r = await deleteLabelAction(labelId)
      if (!r.ok) toast(r.message)
      router.refresh()
    })
  }
  return (
    <section aria-label="Project labels" className="rounded-xl border border-border bg-surface p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-default">Labels</h2>
        {canEdit && (
          <button type="button" onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
            <Plus size={14} aria-hidden />Label
          </button>
        )}
      </div>
      {scoped.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No project labels yet — add one to tag this project&apos;s issues.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {scoped.map((l) => (
            <li key={l.id} className="flex items-center gap-0.5">
              {/* The issue-row chip recipe: --label-* text token over a 14% tint
                  of the stored --status-* hue (both themes contrast-gated). */}
              <span className="rounded-full px-2 py-0.5 text-xs" style={{ color: `var(${labelTextVar(l.color)})`, background: `color-mix(in srgb, var(${l.color}) 14%, var(--bg-canvas))` }}>{l.name}</span>
              {canEdit && (
                <Menu label={`Label actions: ${l.name}`} button={<MoreHorizontal size={16} aria-hidden />}
                  items={[
                    { label: 'Rename…', onSelect: () => setRenaming(l) },
                    { label: 'Delete', danger: true, onSelect: () => del(l.id) },
                  ]} />
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <LabelDialog title="New label" initial="" pending={pending} onClose={() => setAdding(false)} onSave={add} />}
      {renaming && <LabelDialog title="Rename label" initial={renaming.name} pending={pending} onClose={() => setRenaming(null)} onSave={(name) => rename(renaming.id, name)} />}
    </section>
  )
}
