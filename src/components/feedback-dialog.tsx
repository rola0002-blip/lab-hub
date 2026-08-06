'use client'
import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Bug, ImagePlus, Lightbulb, X } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/lib/toast-store'
import { subscribeFeedbackComposer, getFeedbackComposer, closeFeedbackComposer } from '@/lib/feedback-composer-store'

// Client-side pre-check only. The real cap is the server's FEEDBACK_MAX in
// src/lib/uploads.ts, which is module-private AND `server-only`, so it cannot be
// imported here — this constant is a deliberate local mirror that saves the user a
// 10 MB round-trip. If the two ever drift the server still wins (400 invalid_upload,
// surfaced inline below).
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024

// Machine tokens the route returns in `error`; every OTHER `error` value is a
// PolicyError message — a human sentence meant to be shown verbatim (the documents
// route's shape, inherited). Keeping the token list explicit is what lets the two
// be told apart without guessing at the string.
const ERROR_TOKENS = new Set(['unauthorized', 'bad_request', 'invalid_upload', 'rate_limited'])
const GENERIC_ERROR = 'Could not send your feedback. Please try again.'
const RATE_LIMIT_ERROR = "You're sending feedback too quickly — try again in a few minutes."

type FeedbackType = 'BUG' | 'IDEA'

const TYPE_BUTTON = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
const typeButton = (on: boolean) => `${TYPE_BUTTON} ${on
  ? 'border-[var(--border-focus)] bg-selected font-medium text-[var(--text-accent)]'
  : 'border-border text-default hover:bg-hover active:bg-active'}`

/**
 * Globally-mounted "Give feedback" dialog (spec §9.1). Mounted once beside
 * <CreateIssueModal /> in (app)/layout.tsx and raised from the sidebar footer or the
 * ⌘K palette. Unlike the issue composer there is NO guest gate — every signed-in
 * role can submit. Returns null when closed, so the form state is fresh on each open.
 */
export function FeedbackDialog({ version }: { version: string }) {
  const store = useSyncExternalStore(subscribeFeedbackComposer, getFeedbackComposer, getFeedbackComposer)
  if (!store.open) return null
  return <Composer version={version} pagePath={store.pagePath} />
}

function Composer({ version, pagePath }: { version: string; pagePath: string }) {
  const router = useRouter()
  // No default type: the pick is required, and a pre-selected "Bug" would quietly
  // mislabel every idea submitted by someone who skipped the row.
  const [type, setType] = useState<FeedbackType | null>(null)
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)
  const typeLabelId = useId()
  // Mirrors `preview` so the unmount cleanup can revoke without re-running on every
  // state change (an effect keyed on `preview` would revoke the URL the <img> is
  // still showing the moment any other field changes).
  const previewRef = useRef<string | null>(null)

  // The dialog unmounts on close (FeedbackDialog returns null), so this is the
  // close/Escape/backdrop revoke path as well as the last-picked-file one.
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])

  function pick(next: File | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current) // replace + clear both revoke
    const url = next ? URL.createObjectURL(next) : null
    previewRef.current = url
    setFile(next)
    setPreview(url)
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null
    if (next && next.size > MAX_SCREENSHOT_BYTES) {
      toast('That screenshot is over 10 MB. Try a smaller image.')
      e.target.value = '' // let the same file be re-picked after shrinking it
      return
    }
    pick(next)
  }

  function removeFile() {
    pick(null)
    if (fileRef.current) fileRef.current.value = '' // else re-picking the SAME file fires no change event
  }

  const ready = type !== null && body.trim().length > 0

  function submit() {
    if (!ready || !type) return
    setError(null)
    start(async () => {
      const form = new FormData()
      form.set('type', type)
      form.set('body', body.trim())
      form.set('pagePath', pagePath)
      if (file) form.set('screenshot', file) // key is `screenshot`, NOT `file` (documents' key)
      const res = await fetch('/api/feedback', { method: 'POST', body: form }).catch(() => null)
      if (res?.ok) {
        closeFeedbackComposer()
        toast('Thanks — your feedback is in.')
        router.refresh() // updates /feedback when that is where the user is; harmless elsewhere
        return
      }
      // Every failure keeps the fields: the body is the expensive part to retype.
      if (!res) { setError(GENERIC_ERROR); return }
      if (res.status === 429) { setError(RATE_LIMIT_ERROR); return }
      const data: unknown = await res.json().catch(() => null)
      const payload = (data ?? {}) as { error?: unknown; message?: unknown }
      if (payload.error === 'invalid_upload' && typeof payload.message === 'string') { setError(payload.message); return }
      if (typeof payload.error === 'string' && !ERROR_TOKENS.has(payload.error)) { setError(payload.error); return }
      setError(GENERIC_ERROR)
    })
  }

  return (
    <Modal title="Give feedback" onClose={closeFeedbackComposer}>
      <div className="space-y-4">
        <div>
          <p id={typeLabelId} className="text-sm font-medium text-default">What kind of feedback is this?</p>
          <div role="group" aria-labelledby={typeLabelId} className="mt-1.5 grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={type === 'BUG'} onClick={() => setType('BUG')} className={typeButton(type === 'BUG')}>
              <Bug size={16} aria-hidden /> Bug
            </button>
            <button type="button" aria-pressed={type === 'IDEA'} onClick={() => setType('IDEA')} className={typeButton(type === 'IDEA')}>
              <Lightbulb size={16} aria-hidden /> Idea
            </button>
          </div>
        </div>

        <label className="block text-sm font-medium text-default">
          Details
          {/* No autoFocus: Modal's useFocusTrap lands focus on its Close button after
              mount, so the attribute never held — it only implied a lie about focus. */}
          <textarea
            required maxLength={4000} rows={5} value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What happened, or what would you change?"
            className="mt-1.5 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-base font-normal text-default placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
          />
        </label>

        <div className="space-y-2">
          {/* Label-wrapped input: clicking anywhere on the tile opens the picker, and the
              sr-only input stays a real keyboard target with "Attach a screenshot" as its
              accessible name (the profile-photo idiom). Label text is deliberately CONSTANT
              once a file is picked — the thumbnail below is the "attached" signal. */}
          <label className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border px-3 text-sm text-muted transition-colors hover:bg-hover hover:text-default active:bg-active focus-within:outline-none focus-within:ring-2 focus-within:ring-[var(--ring-focus)]">
            <ImagePlus size={16} aria-hidden />
            Attach a screenshot
            <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={onPickFile} />
          </label>
          {preview && (
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob: preview of the user's own pick, never a remote asset */}
              <img src={preview} alt="Screenshot preview" className="h-12 w-12 shrink-0 rounded-md border border-border object-cover" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{file?.name}</span>
              <button
                type="button" onClick={removeFile} aria-label="Remove screenshot"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-default active:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          )}
        </div>

        {/* Transparency: exactly what rides along invisibly with the submission. */}
        <p className="text-2xs text-subtle">Includes: v{version} · {pagePath} · browser info</p>

        {error && <p role="alert" className="text-sm text-[var(--text-danger)]">{error}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button" onClick={closeFeedbackComposer}
            className="min-h-11 w-full rounded-md border border-border px-4 text-sm text-default transition-colors hover:bg-hover active:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="button" onClick={submit} disabled={!ready || pending}
            className="min-h-11 w-full rounded-md bg-accent px-4 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover active:bg-[var(--accent-active)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] sm:w-auto"
          >
            Send feedback
          </button>
        </div>
      </div>
    </Modal>
  )
}
