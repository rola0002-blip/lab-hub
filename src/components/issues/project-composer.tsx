'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { createProjectAction, updateProjectAction } from '@/app/(app)/issues/actions'
import { toast } from '@/lib/toast-store'
import type { ProjectDto } from '@/features/issues/project-service'
import type { ProjectStatus } from '@prisma/client'

type Opt = { id: string; name: string }
const PROJECT_STATUSES: ProjectStatus[] = ['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELED']
const statusLabel = (s: ProjectStatus) => s.charAt(0) + s.slice(1).toLowerCase()

const FIELD = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
const SELECT = 'mt-1 w-full rounded-md border border-border bg-surface px-2 py-2 text-sm text-default focus-visible:border-[var(--border-focus)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'

export function ProjectComposer({ users, folders, existing, onClose }: {
  users: Opt[]; folders: Opt[]; existing?: ProjectDto; onClose: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [leadId, setLeadId] = useState<string | null>(existing?.lead?.id ?? null)
  // v0.15 §5.3 — null (never '') is the unlink value: the service validates any
  // non-null id, so an empty string reaches assertFolderExists and 400s instead of
  // clearing the link. Normalised at the boundary, exactly like leadId below.
  const [documentFolderId, setDocumentFolderId] = useState<string | null>(existing?.documentFolder?.id ?? null)
  const [startDate, setStartDate] = useState(existing?.startDate ? existing.startDate.slice(0, 10) : '')
  const [targetDate, setTargetDate] = useState(existing?.targetDate ? existing.targetDate.slice(0, 10) : '')
  const [status, setStatus] = useState<ProjectStatus>(existing?.status ?? 'ACTIVE')
  const [pending, start] = useTransition()

  function submit() {
    const n = name.trim(); if (!n) { toast('Enter a project name.'); return }
    start(async () => {
      const input = { name: n, description, leadId, documentFolderId, startDate: startDate || null, targetDate: targetDate || null, status }
      const r = existing ? await updateProjectAction(existing.id, input) : await createProjectAction(input)
      if (r.ok) {
        onClose()
        // Create navigates; edit stays put. run() revalidates the LIST routes only —
        // never `/projects/[id]`, the route an edit is usually made from — so the
        // detail page asks for its own repaint rather than leaning on Next's
        // post-action router-cache invalidation (which happens to cover it today).
        if (existing) router.refresh(); else router.push(`/projects/${r.data.id}`)
      }
      else toast(r.message)
    })
  }
  return (
    <Modal title={existing ? 'Edit project' : 'New project'} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm text-default">Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} required className={FIELD} />
        </label>
        <label className="block text-sm text-default">Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={FIELD} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-default">Lead
            <select value={leadId ?? ''} onChange={(e) => setLeadId(e.target.value || null)} className={SELECT}>
              <option value="">No lead</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label className="block text-sm text-default">Status
            <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} className={SELECT}>
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          <label className="block text-sm text-default">Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={SELECT} />
          </label>
          <label className="block text-sm text-default">Target date
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={SELECT} />
          </label>
          {/* The hint is a SIBLING of the label, not inside it: everything a label wraps
              joins the control's accessible name, and this cell is the field's own grid
              slot so the line still reads directly under the select. */}
          <div>
            <label className="block text-sm text-default">Files folder
              <select value={documentFolderId ?? ''} onChange={(e) => setDocumentFolderId(e.target.value || null)} className={SELECT}>
                <option value="">No folder</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <p className="mt-1 text-xs text-subtle">Folders are shared workspace-wide — linking does not restrict access.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
          <button type="button" onClick={submit} disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
            {existing ? 'Save project' : 'Create project'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function NewProjectButton({ users, folders }: { users: Opt[]; folders: Opt[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
        <Plus size={15} aria-hidden />New project
      </button>
      {open && <ProjectComposer users={users} folders={folders} onClose={() => setOpen(false)} />}
    </>
  )
}
