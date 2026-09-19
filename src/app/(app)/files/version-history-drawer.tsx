'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Download, RotateCcw } from 'lucide-react'
import { useFocusTrap } from '@/components/hooks/use-focus-trap'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/lib/toast-store'
import type { Role } from '@/lib/session'
import { canModifyDocument } from '@/features/documents/documents-policy'
import { restoreVersionAction } from './actions'

// v0.32 version history drawer — the thread-panel drawer pattern: portaled to
// <body> over a backdrop, focus-trapped, Esc closes, and #app-content behind it
// goes inert so nothing behind the drawer is reachable by pointer or AT.

// The GET /api/documents/[id]/versions wire shape (created arrives pre-formatted
// in the org timezone; path serves through the normal uploads gate).
type VersionRow = { id: string; version: number; name: string; mime: string; size: number; path: string; uploadedByName: string; created: string }

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function VersionHistoryDrawer({ docId, docName, uploaderId, role, selfId, onClose }: {
  docId: string; docName: string; uploaderId: string; role: Role; selfId: string; onClose: () => void
}) {
  const router = useRouter()
  const [versions, setVersions] = useState<VersionRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const drawerRef = useRef<HTMLElement>(null)
  useFocusTrap(drawerRef, true)

  const load = useCallback(async () => {
    const r = await fetch(`/api/documents/${docId}/versions`)
    if (!r.ok) return
    const d = await r.json()
    setVersions(d.versions as VersionRow[])
  }, [docId])

  // load() only setStates after awaiting fetch — async, never a synchronous cascading render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  // Escape closes the drawer (matches the ✕ button); the thread-panel convention.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Mark the shell behind the drawer inert (the drawer is portaled to <body>,
  // outside #app-content, so inert never disables it). Thread-panel precedent.
  useEffect(() => {
    const content = document.getElementById('app-content')
    content?.setAttribute('inert', '')
    return () => content?.removeAttribute('inert')
  }, [])

  const mayRestore = canModifyDocument(role, uploaderId, selfId)
  const latest = versions?.[0]?.version // listVersions is newest-first

  async function restore(versionId: string) {
    if (busy) return
    setBusy(true)
    try {
      const r = await restoreVersionAction(versionId)
      if (r.ok) { toast('Version restored.'); await load(); router.refresh() } // row chip catches up behind the drawer
      else toast(r.message)
    } finally { setBusy(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button type="button" aria-hidden tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/50" />
      <aside ref={drawerRef} role="dialog" aria-modal="true" aria-label="Version history"
        className="absolute inset-y-0 right-0 flex w-full max-w-[26rem] flex-col border-l border-border bg-surface shadow-modal outline-none">
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-default">Version history</h2>
            <p className="truncate text-xs text-subtle" title={docName}>{docName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close version history"
            className="rounded p-1 text-muted hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">✕</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {versions === null ? (
            <div className="space-y-4 p-3">
              <Skeleton lines={2} />
              <Skeleton lines={2} />
            </div>
          ) : versions.length === 0 ? (
            <p className="p-4 text-sm text-muted">No versions recorded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {versions.map((v) => (
                <li key={v.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex shrink-0 items-center rounded-full border border-border px-1.5 py-0.5 text-2xs font-medium text-subtle">v{v.version}</span>
                    {v.version === latest && <span className="text-2xs font-semibold uppercase tracking-wide text-subtle">Current</span>}
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-subtle">{fmtSize(v.size)}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-default" title={v.name}>{v.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{v.uploadedByName} · {v.created}</p>
                  <div className="mt-1.5 flex items-center gap-4">
                    {/* The uploads route serves any version's path (per-kind gate). */}
                    <a href={v.path} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded text-xs text-default hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
                      <Download size={12} aria-hidden /> Download
                    </a>
                    {mayRestore && v.version !== latest && (
                      <button type="button" onClick={() => void restore(v.id)} disabled={busy}
                        className="inline-flex items-center gap-1 rounded text-xs text-default hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] disabled:opacity-50">
                        <RotateCcw size={12} aria-hidden /> Restore
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
