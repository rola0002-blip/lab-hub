'use client'
import { useSyncExternalStore, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CircleCheck, TriangleAlert, CircleAlert } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { PROJECT_HEALTH_LABEL, HEALTH_TOKEN } from '@/features/issues/project-health'
import { postProjectUpdateAction } from '@/app/(app)/issues/actions'
import { subscribeProjectUpdateComposer, getProjectUpdateComposer, closeProjectUpdateComposer } from '@/lib/project-update-composer-store'
import { toast } from '@/lib/toast-store'
import type { ProjectHealth } from '@prisma/client'

// Glyph per health, matching HealthChip: the choice is never colour-alone — every
// option carries its own lucide shape plus the visible word in text-default.
const GLYPH = { ON_TRACK: CircleCheck, AT_RISK: TriangleAlert, OFF_TRACK: CircleAlert } as const
// Mirrors the action's zod cap (and the service's trim/slice) so the textarea can
// never build an update the server would reject outright.
const BODY_MAX = 4000
type Opt = { id: string; name: string }

// Globally-mounted "post project update" composer (the CreateIssueModal shape):
// the outer component only subscribes, so the inner Composer mounts fresh — its
// useState seeds read the prefill once, per open.
export function ProjectUpdateModal({ projects }: { projects: Opt[] }) {
  const store = useSyncExternalStore(subscribeProjectUpdateComposer, getProjectUpdateComposer, getProjectUpdateComposer)
  if (!store.open) return null
  return <Composer projects={projects} />
}

function Composer({ projects }: { projects: Opt[] }) {
  const router = useRouter()
  const { prefill } = getProjectUpdateComposer()
  const [projectId, setProjectId] = useState<string>(prefill.projectId ?? '')
  const [health, setHealth] = useState<ProjectHealth>('ON_TRACK')
  const [body, setBody] = useState(prefill.body ?? '')
  const [pending, start] = useTransition()

  function submit() {
    if (!projectId) { toast('Choose a project.'); return }
    if (!body.trim()) { toast('An update needs a few words.'); return }
    start(async () => {
      const r = await postProjectUpdateAction({ projectId, health, body, originMessageId: prefill.originMessageId ?? null })
      // Updates have no SSE channel (the Files precedent): land on the project and
      // refresh the server render so the new row is there when the page paints.
      if (r.ok) { closeProjectUpdateComposer(); router.push(`/projects/${projectId}`); router.refresh() }
      else toast(r.message)
    })
  }
  return (
    <Modal title="Post project update" wide onClose={closeProjectUpdateComposer}>
      <div className="space-y-3">
        <label className="block text-sm text-default">Project
          <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
            <option value="">Choose a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <fieldset>
          <legend className="text-sm text-default">Health</legend>
          {/* Radio group, not a select: the health call is the point of the update,
              so all three options stay visible with their glyphs. The input is
              sr-only — the label carries the visible chip, the focus ring
              (focus-within) and the accessible name. */}
          <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Project health">
            {(['ON_TRACK', 'AT_RISK', 'OFF_TRACK'] as const).map((h) => {
              const Icon = GLYPH[h]
              const on = health === h
              return (
                <label key={h}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm text-default hover:bg-hover focus-within:ring-2 focus-within:ring-[var(--ring-focus)] ${on ? 'border-border-strong bg-selected' : 'border-border'}`}>
                  <input type="radio" name="health" value={h} checked={on} onChange={() => setHealth(h)} className="sr-only" />
                  <Icon size={14} aria-hidden style={{ color: `var(${HEALTH_TOKEN[h]})` }} />
                  {PROJECT_HEALTH_LABEL[h]}
                </label>
              )
            })}
          </div>
        </fieldset>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} aria-label="Update" maxLength={BODY_MAX}
          placeholder="What moved this week? Setbacks count — they're progress too."
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={closeProjectUpdateComposer} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
          <button type="button" onClick={submit} disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Post update</button>
        </div>
      </div>
    </Modal>
  )
}
