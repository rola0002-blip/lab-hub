'use client'
import { useRef, useState, useTransition } from 'react'
import { Paperclip, SendHorizontal } from 'lucide-react'
import { IssueMentionInput } from './issue-mention-input'
import { createCommentAction, attachIssueFilesAction } from '@/app/(app)/issues/actions'
import { toast } from '@/lib/toast-store'

type Opt = { id: string; name: string; image?: string | null }
export function IssueComposer({ issueId, users }: { issueId: string; users: Opt[] }) {
  const [body, setBody] = useState('')
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch('/api/issues/attachments', { method: 'POST', body: fd }).catch(() => null)
    if (!res || !res.ok) { toast('Could not upload that file.'); return }
    const meta = await res.json() as { path: string; name: string; mime: string; size: number }
    // Persist the IssueAttachment row (issue-level gallery). The action's
    // revalidatePath + the `issue` SSE event re-render the Attachments section.
    const r = await attachIssueFilesAction(issueId, [meta])
    if (!r.ok) { toast(r.message); return }
    toast('File attached.')
  }
  function submit() {
    const text = body.trim(); if (!text) return
    start(async () => {
      const r = await createCommentAction(issueId, text)
      if (r.ok) setBody(''); else toast(r.message)
    })
  }
  return (
    <div className="rounded-lg border border-border bg-surface p-2 shadow-composer">
      <IssueMentionInput value={body} onChange={setBody} users={users} ariaLabel="Write a comment" placeholder="Leave a comment…  @ to mention" />
      <div className="mt-1 flex items-center gap-2">
        <button type="button" aria-label="Attach a file" onClick={() => fileRef.current?.click()} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"><Paperclip size={16} aria-hidden /></button>
        <input ref={fileRef} type="file" className="sr-only" onChange={onFiles} />
        <span className="flex-1" />
        <button type="button" onClick={submit} disabled={pending || !body.trim()} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
          <SendHorizontal size={15} aria-hidden />Comment
        </button>
      </div>
    </div>
  )
}
