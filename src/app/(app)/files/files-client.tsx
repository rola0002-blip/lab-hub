'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FileText, FileImage, FileSpreadsheet, FileArchive, File as FileIcon, Folder, FolderPlus, Upload, Search, MoreHorizontal } from 'lucide-react'
import { Menu } from '@/components/ui/menu'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import { toast } from '@/lib/toast-store'
import type { Role } from '@/lib/session'
import { canUpload, canDeleteDocument, canManageFolder } from '@/features/documents/documents-policy'
import {
  createFolderAction, renameFolderAction, deleteFolderAction,
  renameDocumentAction, moveDocumentAction, deleteDocumentAction,
} from './actions'

type FolderVM = { id: string; name: string; createdById: string }
type DocVM = { id: string; name: string; path: string; mime: string; size: number; uploaderId: string; uploaderName: string; created: string; folderId: string | null }
type SearchHit = { id: string; name: string; path: string; mime: string }
type Dialog =
  | { kind: 'newfolder' } | { kind: 'renamefolder'; id: string; name: string }
  | { kind: 'renamedoc'; id: string; name: string } | { kind: 'movedoc'; id: string; name: string }

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
function TypeIcon({ mime }: { mime: string }) {
  const cls = 'shrink-0 text-subtle'
  if (mime.startsWith('image/')) return <FileImage size={16} className={cls} aria-hidden />
  if (mime === 'application/pdf') return <FileText size={16} className={cls} aria-hidden />
  if (mime.includes('spreadsheet') || mime === 'text/csv') return <FileSpreadsheet size={16} className={cls} aria-hidden />
  if (mime === 'application/zip') return <FileArchive size={16} className={cls} aria-hidden />
  return <FileIcon size={16} className={cls} aria-hidden />
}

export function FilesClient({ folders, documents, currentFolderId, role, selfId }: {
  folders: FolderVM[]; documents: DocVM[]; currentFolderId: string | null; role: Role; selfId: string
}) {
  const router = useRouter()
  const mayUpload = canUpload(role)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [uploading, setUploading] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [dialogName, setDialogName] = useState('')
  const [moveTarget, setMoveTarget] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const current = folders.find((f) => f.id === currentFolderId) ?? null

  // Debounced filename search across all folders (null hits = not searching).
  useEffect(() => {
    const q = query.trim()
    if (!q) return // cleared in onChange, not here (avoids sync setState-in-effect — the SearchBox precedent, search-box.tsx:88)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/documents/search?q=${encodeURIComponent(q)}`)
        if (r.ok) setHits((await r.json()).hits as SearchHit[])
      } catch { /* transient */ }
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  async function uploadFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1)
      try {
        const fd = new FormData(); fd.append('file', file)
        if (currentFolderId) fd.append('folderId', currentFolderId)
        const r = await fetch('/api/documents', { method: 'POST', body: fd })
        if (!r.ok) { const d = await r.json().catch(() => null); toast(d?.message ?? 'Upload failed.') }
      } catch { toast('Upload failed.') } finally { setUploading((n) => n - 1) }
    }
    if (fileRef.current) fileRef.current.value = ''
    router.refresh()
  }

  async function run(p: Promise<{ ok: boolean; message?: string }>, ok: string) {
    const r = await p
    if (r.ok) { toast(ok); setDialog(null); router.refresh() } else toast(r.message ?? 'Something went wrong.')
  }
  async function del(id: string) {
    if (!confirm('Delete this file? This cannot be undone.')) return
    const r = await deleteDocumentAction(id)
    if (r.ok) { toast('File deleted.'); router.refresh() } else toast(r.message)
  }
  async function delFolder(id: string) {
    if (!confirm('Delete this folder? It must be empty.')) return
    const r = await deleteFolderAction(id)
    if (r.ok) { toast('Folder deleted.'); router.refresh() } else toast(r.message)
  }
  function openDialog(d: Dialog) {
    setDialog(d)
    setDialogName('name' in d ? d.name : '')
    if (d.kind === 'movedoc') setMoveTarget(currentFolderId ?? '')
  }

  const link = 'flex h-8 items-center gap-2 rounded-md px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
  const rows: DocVM[] = hits
    ? hits.map((h) => ({ id: h.id, name: h.name, path: h.path, mime: h.mime, size: 0, uploaderId: '', uploaderName: '', created: '', folderId: null }))
    : documents

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[13rem_1fr]">
      {/* Folder rail. The per-folder Menu is a SIBLING of the navigation Link (never
          nested inside it) so there is no interactive-inside-interactive a11y violation. */}
      <aside className="space-y-1">
        <Link href="/files" aria-current={currentFolderId === null ? 'page' : undefined}
          className={`${link} ${currentFolderId === null ? 'bg-selected font-medium text-[var(--text-accent)]' : 'text-default hover:bg-hover'}`}>
          <Folder size={15} aria-hidden /> All files
        </Link>
        {folders.map((f) => (
          <div key={f.id} className="flex items-center gap-1">
            <Link href={`/files?folder=${f.id}`} aria-current={currentFolderId === f.id ? 'page' : undefined}
              className={`${link} min-w-0 flex-1 ${currentFolderId === f.id ? 'bg-selected font-medium text-[var(--text-accent)]' : 'text-default hover:bg-hover'}`}>
              <Folder size={15} aria-hidden /><span className="min-w-0 flex-1 truncate">{f.name}</span>
            </Link>
            {canManageFolder(role, f.createdById, selfId) && (
              <Menu label={`Folder ${f.name} actions`} button={<MoreHorizontal size={16} aria-hidden />} items={[
                { label: 'Rename', onSelect: () => openDialog({ kind: 'renamefolder', id: f.id, name: f.name }) },
                { label: 'Delete', danger: true, onSelect: () => delFolder(f.id) },
              ]} />
            )}
          </div>
        ))}
        {mayUpload && (
          <button type="button" onClick={() => openDialog({ kind: 'newfolder' })}
            className={`${link} w-full text-muted hover:bg-hover hover:text-default`}>
            <FolderPlus size={15} aria-hidden /> New folder
          </button>
        )}
      </aside>

      {/* Main: search + upload + table */}
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5">
            <Search size={15} aria-hidden className="shrink-0 text-subtle" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) setHits(null) }} placeholder="Search files by name…"
              aria-label="Search files" className="h-9 w-full bg-transparent text-sm text-default outline-none placeholder:text-subtle" />
          </div>
          {mayUpload && (
            <>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading > 0}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on transition-colors hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
                <Upload size={15} aria-hidden /> {uploading > 0 ? 'Uploading…' : 'Upload'}
              </button>
            </>
          )}
        </div>

        {/* Drag-and-drop zone (members/admins only). Spec §6.8 requires a :focus-visible
            ring on the drop zone, so it is a real keyboard target (role=button + tabIndex +
            aria-label + Enter/Space → the file picker) rather than a bare non-focusable <div>
            — also honoring the global "every interactive element needs :focus-visible" rule.
            Gated by mayUpload, so guests never render it (the T18 "no Upload affordance"
            guest assertion still holds). */}
        {mayUpload && (
          <div
            role="button" tabIndex={0}
            aria-label={`Upload files${current ? ` to ${current.name}` : ''}`}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files) }}
            className={`mt-3 rounded-lg border border-dashed p-4 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] ${dragOver ? 'border-[var(--border-focus)] bg-hover text-default' : 'border-border text-muted'}`}>
            Drag files here to upload{current ? ` to ${current.name}` : ''}.
          </div>
        )}

        {/* Table (or search results across all folders) */}
        {rows.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={FileText}
              title={hits ? 'No files match your search' : 'No files here yet'}
              hint={hits ? 'Try a different filename.' : mayUpload ? 'Upload a file or drag one into the drop zone above.' : 'Files uploaded by your lab will appear here.'} />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
            {rows.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <TypeIcon mime={d.mime} />
                {/* pdf/image open inline in a new tab; office files download — the serving
                    route sets Content-Disposition, so a single anchor handles both. */}
                <a href={d.path} target="_blank" rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-default hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">{d.name}</a>
                {!hits && <span className="hidden w-16 shrink-0 text-right tabular-nums text-subtle sm:block">{fmtSize(d.size)}</span>}
                {!hits && <span className="hidden w-40 shrink-0 truncate text-muted md:block">{d.uploaderName}</span>}
                {!hits && <span className="hidden w-44 shrink-0 truncate text-subtle lg:block">{d.created}</span>}
                {!hits && (mayUpload || canDeleteDocument(role, d.uploaderId, selfId)) && (
                  <Menu label={`File ${d.name} actions`} button={<MoreHorizontal size={16} aria-hidden />} items={[
                    ...(mayUpload ? [
                      { label: 'Rename', onSelect: () => openDialog({ kind: 'renamedoc', id: d.id, name: d.name }) },
                      { label: 'Move…', onSelect: () => openDialog({ kind: 'movedoc', id: d.id, name: d.name }) },
                    ] : []),
                    { label: 'Download', onSelect: () => window.open(d.path, '_blank', 'noopener') },
                    ...(canDeleteDocument(role, d.uploaderId, selfId) ? [{ label: 'Delete', danger: true, onSelect: () => del(d.id) }] : []),
                  ]} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dialogs */}
      {dialog && (dialog.kind === 'newfolder' || dialog.kind === 'renamefolder' || dialog.kind === 'renamedoc') && (
        <Modal title={dialog.kind === 'newfolder' ? 'New folder' : dialog.kind === 'renamefolder' ? 'Rename folder' : 'Rename file'} onClose={() => setDialog(null)}>
          <label className="block text-sm text-default">Name
            <input autoFocus value={dialogName} onChange={(e) => setDialogName(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setDialog(null)} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover">Cancel</button>
            <button onClick={() => {
              const name = dialogName.trim(); if (!name) return
              if (dialog.kind === 'newfolder') void run(createFolderAction(name), 'Folder created.')
              else if (dialog.kind === 'renamefolder') void run(renameFolderAction(dialog.id, name), 'Folder renamed.')
              else void run(renameDocumentAction(dialog.id, name), 'File renamed.')
            }} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover">Save</button>
          </div>
        </Modal>
      )}
      {dialog && dialog.kind === 'movedoc' && (
        <Modal title={`Move ${dialog.name}`} onClose={() => setDialog(null)}>
          <label className="block text-sm text-default">Destination folder
            <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
              <option value="">All files (root)</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setDialog(null)} className="rounded-md border border-border px-3 py-1.5 text-sm text-default hover:bg-hover">Cancel</button>
            <button onClick={() => void run(moveDocumentAction(dialog.id, moveTarget || null), 'File moved.')}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-on hover:bg-accent-hover">Move</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
