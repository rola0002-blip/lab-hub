'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, Plus, UserX } from 'lucide-react'
import { renderTokens } from '@/components/chat/render-tokens'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Menu } from '@/components/ui/menu'
import { Modal } from '@/components/ui/modal'
import { ProgressBar } from './progress-bar'
import { ProjectComposer } from './project-composer'
import { HealthChip } from './health-chip'
import { openIssueComposer } from '@/lib/issue-composer-store'
import { openProjectUpdateComposer } from '@/lib/project-update-composer-store'
import { deleteProjectAction, pauseUpdatePromptsAction, resumeUpdatePromptsAction } from '@/app/(app)/issues/actions'
import { isProjectUpdateStale } from '@/features/issues/stale'
import { toast } from '@/lib/toast-store'
import { formatDay } from '@/lib/time'
import type { ProjectDto } from '@/features/issues/project-service'
import type { Role } from '@/lib/session'

const STATUS_VARIANT = { ACTIVE: 'success', PAUSED: 'warning', COMPLETED: 'neutral', CANCELED: 'danger' } as const
type Opt = { id: string; name: string }
export function ProjectHeader({ project, role, users, timezone, today }: { project: ProjectDto; role: Role; users: Opt[]; timezone: string; today: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [pending, start] = useTransition()
  const canEdit = role !== 'guest'
  const names = new Map(users.map((u) => [u.id, u.name]))

  function del() {
    start(async () => {
      const r = await deleteProjectAction(project.id)
      if (r.ok) router.push('/projects')
      else { setConfirmDel(false); toast(r.message) }
    })
  }
  // Snooze controls (spec §4.6). `weeks` MUST be the numeric literals 1 | 4 — the
  // action re-validates them at runtime, so anything else is refused outright.
  const menuItems = [
    ...(canEdit ? [
      { label: 'Edit project', onSelect: () => setEditing(true) },
      { label: 'Skip the next prompt', onSelect: () => start(async () => { const r = await pauseUpdatePromptsAction(project.id, 1); toast(r.ok ? 'Next prompt skipped.' : r.message); router.refresh() }) },
      { label: 'Pause updates for 4 weeks', onSelect: () => start(async () => { const r = await pauseUpdatePromptsAction(project.id, 4); toast(r.ok ? 'Prompts paused for 4 weeks.' : r.message); router.refresh() }) },
      { label: 'Resume update prompts', onSelect: () => start(async () => { const r = await resumeUpdatePromptsAction(project.id); toast(r.ok ? 'Prompts resumed.' : r.message); router.refresh() }) },
    ] : []),
    ...(role === 'admin' ? [{ label: 'Delete project', danger: true, onSelect: () => setConfirmDel(true) }] : []),
  ]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-default">{project.name}</h1>
          <Badge variant={STATUS_VARIANT[project.status]}>{project.status.toLowerCase()}</Badge>
          {/* Same chips as the project card (§4.7) — the detail page must never
              disagree with the list about a project's health or its lead. */}
          <HealthChip health={project.latestUpdate?.health ?? null} stale={isProjectUpdateStale(project.latestUpdate?.createdAt ?? null, today, timezone)} />
          {project.status === 'ACTIVE' && !project.hasEffectiveLead && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-2xs text-subtle"><UserX size={11} aria-hidden />No lead</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              {/* Secondary next to the accent "New issue": posting an update is the
                  weekly habit, filing an issue is the primary action here. */}
              <button type="button" onClick={() => openProjectUpdateComposer({ projectId: project.id })} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
                Post update
              </button>
              <button type="button" onClick={() => openIssueComposer({ projectId: project.id })} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
                <Plus size={15} aria-hidden />New issue
              </button>
            </>
          )}
          {menuItems.length > 0 && <Menu label="Project actions" button={<MoreHorizontal size={16} aria-hidden />} items={menuItems} />}
        </div>
      </div>
      {/* Markdown, matching the issue-description peer (issue-detail.tsx) and the
          SP4 spec's "description (markdown)" — this field alone still rendered
          literal text. Valid inside the <p>: render-tokens emits block-ish tokens as
          <span class="block">. text-default (not text-muted) because the `bold` token
          hardcodes text-default and would otherwise outshine its own paragraph.
          Rendering-only parity — no mention parsing/notification in project-service. */}
      {project.description && <p className="max-w-2xl whitespace-pre-wrap text-sm text-default">{renderTokens(project.description, names)}</p>}
      <div className="flex items-center gap-3 text-xs text-muted">
        {project.lead && <span className="flex items-center gap-1.5"><Avatar size={20} name={project.lead.name} id={project.lead.id} image={project.lead.image} />{project.lead.name}</span>}
        {/* Org-timezone rule (src/lib/time.ts): fixed pattern + org zone, never the
            ambient runtime TZ/locale — deterministic across server/client renders. */}
        {project.startDate && <span>Start {formatDay(new Date(project.startDate), timezone)}</span>}
        {project.targetDate && <span>Target {formatDay(new Date(project.targetDate), timezone)}</span>}
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
