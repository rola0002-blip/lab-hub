'use client'
import { useSyncExternalStore, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CircleCheck, TriangleAlert, CircleAlert, Check, Paperclip } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { IconButton } from '@/components/ui/icon-button'
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
// The action's zod .max(5) / the service's MAX_UPDATE_ATTACHMENTS — blocking the
// 6th upload up front beats letting the whole post fail at submit.
const MAX_ATTACH = 5
type Opt = { id: string; name: string }
type Attach = { path: string; name: string; mime: string; size: number }

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
  const [attachments, setAttachments] = useState<Attach[]>([])
  const [uploading, setUploading] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()

  // The chat composer's onFiles loop: one request per file, chips appear as each
  // 201 lands, and a failed upload toasts without blocking the rest.
  async function onFiles(files: FileList) {
    if (attachments.length + files.length > MAX_ATTACH) { toast(`At most ${MAX_ATTACH} files per update.`); return }
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1)
      try {
        const fd = new FormData(); fd.append('file', file)
        const r = await fetch('/api/project-updates/attachments', { method: 'POST', body: fd })
        const d = await r.json().catch(() => null)
        if (r.ok && d) setAttachments((prev) => [...prev, { path: d.path, name: d.name, mime: d.mime, size: d.size }])
        else toast(d?.message ?? 'Upload failed.')
      } catch { toast('Upload failed.') } finally { setUploading((n) => n - 1) }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  function submit() {
    if (!projectId) { toast('Choose a project.'); return }
    if (!body.trim()) { toast('An update needs a few words.'); return }
    start(async () => {
      const r = await postProjectUpdateAction({ projectId, health, body, originMessageId: prefill.originMessageId ?? null, attachments })
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
              (focus-within) and the accessible name. The fieldset/legend already
              names and groups these, so no redundant role="radiogroup" here.
              CHECKED STATE IS NEVER COLOUR-ALONE (SP8 review): bg-selected on its
              own is ~1.1:1 against the surface, so the selected option also gains
              a lucide Check glyph and semibold text (the accent-picker precedent)
              — the shape/weight delta is what carries the state. Its border moves
              to --ring-focus, the same token accent-picker's selected swatch uses
              and the one `npm run contrast` gates at 3:1 vs canvas for all 10
              accents × both themes. `ring-2` is deliberately NOT used (it would be
              indistinguishable from the focus ring); an unchecked-but-focused
              option therefore still reads apart — ring, but no Check, no bold. */}
          <div className="mt-1 flex flex-wrap gap-2">
            {(['ON_TRACK', 'AT_RISK', 'OFF_TRACK'] as const).map((h) => {
              const Icon = GLYPH[h]
              const on = health === h
              return (
                <label key={h}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm text-default hover:bg-hover focus-within:ring-2 focus-within:ring-[var(--ring-focus)] ${on ? 'border-[var(--ring-focus)] bg-selected font-semibold' : 'border-border'}`}>
                  <input type="radio" name="health" value={h} checked={on} onChange={() => setHealth(h)} className="sr-only" />
                  <Icon size={14} aria-hidden style={{ color: `var(${HEALTH_TOKEN[h]})` }} />
                  {PROJECT_HEALTH_LABEL[h]}
                  {on && <Check size={12} aria-hidden />}
                </label>
              )
            })}
          </div>
        </fieldset>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} aria-label="Update" maxLength={BODY_MAX}
          placeholder="What moved this week? Setbacks count — they're progress too."
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <span key={a.path} className="flex items-center gap-1 rounded-md border border-border bg-surface-sunken px-2 py-1 text-xs text-muted">
                <span className="max-w-[10rem] truncate">📎 {a.name}</span>
                <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Remove ${a.name}`} className="text-subtle hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">✕</button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end justify-end gap-2">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && onFiles(e.target.files)} />
          {/* Removing a chip only drops the reference; the uploaded file stays on
              disk as an accepted orphan (the chat composer's cancel posture). */}
          <IconButton label="Attach a file" onClick={() => fileRef.current?.click()} disabled={uploading > 0}><Paperclip size={16} aria-hidden /></IconButton>
          <button type="button" onClick={closeProjectUpdateComposer} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">Cancel</button>
          <button type="button" onClick={submit} disabled={pending || uploading > 0}
            title={uploading > 0 ? 'Uploading…' : undefined}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">Post update</button>
        </div>
      </div>
    </Modal>
  )
}
