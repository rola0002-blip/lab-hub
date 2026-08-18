'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Plus, MoreHorizontal } from 'lucide-react'
import { Menu } from '@/components/ui/menu'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/lib/toast-store'
import { milestoneBucket, type MilestoneDto } from '@/features/issues/milestone-state'
import { createMilestoneAction, editMilestoneAction, toggleMilestoneAction, deleteMilestoneAction } from '@/app/(app)/issues/actions'

// Horizontal strip under the project description (F4). Glyph+word per state —
// complete is struck-through with a Check, overdue reads the due-date.tsx
// conventions (--text-overdue + 'Overdue · '), upcoming is subtle. No new tokens.
export function MilestoneStrip({ projectId, milestones, canEdit, today }: {
  projectId: string; milestones: MilestoneDto[]; canEdit: boolean; today: string
}) {
  const router = useRouter()
  const [, start] = useTransition()
  const [editing, setEditing] = useState<MilestoneDto | 'new' | null>(null)
  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    start(async () => { const r = await fn(); if (!r.ok) toast(r.message ?? 'Failed.'); router.refresh() })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul className="flex flex-wrap items-center gap-2" aria-label="Milestones">
        {milestones.map((m) => {
          const b = milestoneBucket(m, today)
          return (
            <li key={m.id} className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
              {b === 'complete' && <Check size={12} aria-hidden className="text-subtle" />}
              <span className={b === 'complete' ? 'text-subtle line-through' : b === 'overdue' ? 'font-medium text-[var(--text-overdue)]' : 'text-default'}>{m.name}</span>
              {m.date && <span className={b === 'overdue' ? 'text-[var(--text-overdue)]' : 'text-subtle'}>{b === 'overdue' ? 'Overdue · ' : ''}{m.date}</span>}
              {canEdit && (
                <Menu label={`Milestone ${m.name} actions`} button={<MoreHorizontal size={14} aria-hidden />} items={[
                  { label: m.completedAt ? 'Mark not done' : 'Mark complete', onSelect: () => run(() => toggleMilestoneAction(m.id)) },
                  { label: 'Edit…', onSelect: () => setEditing(m) },
                  { label: 'Remove', danger: true, onSelect: () => run(() => deleteMilestoneAction(m.id)) },
                ]} />
              )}
            </li>
          )
        })}
      </ul>
      {canEdit && (
        <button type="button" onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
          <Plus size={12} aria-hidden />Milestone
        </button>
      )}
      {editing && (
        <MilestoneDialog projectId={projectId} existing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function MilestoneDialog({ projectId, existing, onClose }: { projectId: string; existing: MilestoneDto | null; onClose: () => void }) {
  const [name, setName] = useState(existing?.name ?? '')
  const [date, setDate] = useState(existing?.date ?? '')
  const [pending, start] = useTransition()
  function save() {
    start(async () => {
      const r = existing ? await editMilestoneAction(existing.id, name, date || null) : await createMilestoneAction(projectId, name, date || null)
      if (r.ok) onClose(); else toast(r.message)
    })
  }
  return (
    <Modal title={existing ? 'Edit milestone' : 'New milestone'} onClose={onClose}>
      <label className="mt-3 block text-sm text-default">Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
      </label>
      <label className="mt-3 block text-sm text-default">Date <span className="text-subtle">(optional)</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
        <button type="button" onClick={save} disabled={pending || !name.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Save</button>
      </div>
    </Modal>
  )
}
