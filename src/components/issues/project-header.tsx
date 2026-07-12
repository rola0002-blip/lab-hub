'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Plus } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Menu } from '@/components/ui/menu'
import { Modal } from '@/components/ui/modal'
import { ProgressBar } from './progress-bar'
import { ProjectComposer } from './project-composer'
import { openIssueComposer } from '@/lib/issue-composer-store'
import { deleteProjectAction } from '@/app/(app)/issues/actions'
import { toast } from '@/lib/toast-store'
import type { ProjectDto } from '@/features/issues/project-service'
import type { Role } from '@/lib/session'

const STATUS_VARIANT = { ACTIVE: 'success', PAUSED: 'warning', COMPLETED: 'neutral', CANCELED: 'danger' } as const
type Opt = { id: string; name: string }
export function ProjectHeader({ project, role, users }: { project: ProjectDto; role: Role; users: Opt[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [pending, start] = useTransition()
  const canEdit = role !== 'guest'

  function del() {
    start(async () => {
      const r = await deleteProjectAction(project.id)
      if (r.ok) router.push('/projects')
      else { setConfirmDel(false); toast(r.message) }
    })
  }
  const menuItems = [
    ...(canEdit ? [{ label: 'Edit project', onSelect: () => setEditing(true) }] : []),
    ...(role === 'admin' ? [{ label: 'Delete project', danger: true, onSelect: () => setConfirmDel(true) }] : []),
  ]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-default">{project.name}</h1>
          <Badge variant={STATUS_VARIANT[project.status]}>{project.status.toLowerCase()}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button type="button" onClick={() => openIssueComposer({ projectId: project.id })} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
              <Plus size={15} aria-hidden />New issue
            </button>
          )}
          {menuItems.length > 0 && <Menu label="Project actions" button={<MoreHorizontal size={16} aria-hidden />} items={menuItems} />}
        </div>
      </div>
      {project.description && <p className="max-w-2xl whitespace-pre-wrap text-sm text-muted">{project.description}</p>}
      <div className="flex items-center gap-3 text-xs text-muted">
        {project.lead && <span className="flex items-center gap-1.5"><Avatar size={20} name={project.lead.name} id={project.lead.id} image={project.lead.image} />{project.lead.name}</span>}
        {project.targetDate && <span>Target {new Date(project.targetDate).toLocaleDateString()}</span>}
      </div>
      <div className="max-w-xs"><ProgressBar {...project.progress} /></div>

      {editing && <ProjectComposer users={users} existing={project} onClose={() => setEditing(false)} />}
      {confirmDel && (
        <Modal title="Delete project?" onClose={() => setConfirmDel(false)}>
          <p className="text-sm text-muted">
            Deleting <span className="font-semibold text-default">{project.name}</span> moves its issues to
            {' '}<span className="font-semibold text-default">{'"No project"'}</span> — no issues are deleted. Only admins can do this.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmDel(false)} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
            <button type="button" onClick={del} disabled={pending} className="rounded-md bg-[var(--color-danger)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Delete project</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
