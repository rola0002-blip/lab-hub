'use client'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { FileText, FileImage, FileSpreadsheet, FileArchive, File as FileIcon, Folder, FolderPlus, Upload, Search, MoreHorizontal, ExternalLink, ArrowUp, ArrowDown, Download } from 'lucide-react'
import { Menu } from '@/components/ui/menu'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { useMediaQuery } from '@/components/hooks/use-media-query'
import { toast } from '@/lib/toast-store'
import type { Role } from '@/lib/session'
import { canUpload, canDeleteDocument, canModifyDocument, canManageFolder } from '@/features/documents/documents-policy'
import { sortDocuments, nextSortState, type SortState } from '@/features/documents/sort'
import { parseNameWidth, clampNameWidth, nudgeNameWidth, NAME_WIDTH_MIN } from '@/features/documents/name-width'
import {
  createFolderAction, renameFolderAction, deleteFolderAction,
  renameDocumentAction, moveDocumentAction, deleteDocumentAction,
} from './actions'
import { VersionHistoryDrawer } from './version-history-drawer'

type FolderVM = { id: string; name: string; createdById: string }
type DocVM = { id: string; name: string; path: string; mime: string; size: number; uploaderId: string; uploaderName: string; created: string; folderId: string | null; folderName: string | null; latestVersion: number; createdAtIso: string }
type SearchHit = { id: string; name: string; path: string; mime: string }
type Dialog =
  | { kind: 'newfolder' } | { kind: 'renamefolder'; id: string; name: string }
  | { kind: 'renamedoc'; id: string; name: string } | { kind: 'movedoc'; id: string; name: string; folderId: string | null }

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

const NAME_WIDTH_KEY = 'colossus:files:name-width'
function subscribeNameWidth(cb: () => void) { window.addEventListener('storage', cb); return () => window.removeEventListener('storage', cb) }
function readNameWidthRaw(): string | null { try { return localStorage.getItem(NAME_WIDTH_KEY) } catch { return null } }
// Wave 19: persisted Name-column width — raw-string snapshot (the view-toggle
// idiom) so cross-tab edits propagate; server snapshot null = unresized.
function useNameWidth(): [number | null, (w: number | null) => void] {
  const raw = useSyncExternalStore(subscribeNameWidth, readNameWidthRaw, () => null)
  const width = useMemo(() => parseNameWidth(raw), [raw])
  const set = (w: number | null) => {
    try {
      if (w === null) localStorage.removeItem(NAME_WIDTH_KEY)
      else localStorage.setItem(NAME_WIDTH_KEY, String(w))
    } catch { /* private mode etc. */ }
    window.dispatchEvent(new StorageEvent('storage', { key: NAME_WIDTH_KEY }))
  }
  return [width, set]
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
  // v0.32 versioning: the row whose "Upload new version…" pick is pending (the
  // hidden input mounts only while set, keeping the page at ONE input[type=file]
  // until a pick — the plain Upload flow's selector stays unambiguous), the row
  // whose history drawer is open, and the row pending delete confirmation.
  const [versionPick, setVersionPick] = useState<{ doc: DocVM; n: number } | null>(null)
  const [historyFor, setHistoryFor] = useState<DocVM | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DocVM | null>(null)
  const [confirmFolder, setConfirmFolder] = useState<FolderVM | null>(null)
  const versionFileRef = useRef<HTMLInputElement>(null)
  // Wave 18: tri-state column sort (client-side, ephemeral — not persisted, not
  // auto-cleared; the tri-state third click restores service order) + tick-to-export
  // selection. Both disabled while searching (hits carry no size/folder data).
  const [sortState, setSortState] = useState<SortState>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Ticks survive folder navigation by design — export sends every ticked id; the server skips ids deleted since render.
  const searching = hits !== null
  const listed = searching ? [] : documents
  const shown = sortDocuments(listed, sortState)
  const allListed = listed.length > 0 && listed.every((d) => selected.has(d.id))
  const someListed = listed.some((d) => selected.has(d.id))
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleAll = () => setSelected((s) => {
    const next = new Set(s)
    if (allListed) listed.forEach((d) => next.delete(d.id)); else listed.forEach((d) => next.add(d.id))
    return next
  })
  // Anchor-with-download navigation (not fetch-blob) — the desktop-shell-safe
  // download path; application/zip never renders inline.
  function exportSelected() {
    if (selected.size === 0) return
    const a = document.createElement('a')
    a.href = `/api/documents/export?ids=${encodeURIComponent([...selected].join(','))}`
    a.download = ''
    document.body.appendChild(a); a.click(); a.remove()
  }
  // React has no `indeterminate` prop — sync it imperatively on the live element.
  const selectAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = someListed && !allListed }, [someListed, allListed])
  const current = folders.find((f) => f.id === currentFolderId) ?? null

  // Wave 19: drag-to-resize the Name column. Persisted width in localStorage
  // (per device); the transient dragW wins during the gesture.
  const [nameWidth, setNameWidth] = useNameWidth()
  const [dragW, setDragW] = useState<number | null>(null)
  // During the gesture the transient width wins; release commits to storage then
  // clears the transient in the same batched render (no flash).
  const effectiveW = dragW ?? nameWidth
  const resizing = effectiveW !== null
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)')
  const nameHeadRef = useRef<HTMLDivElement>(null)
  // Gesture anchor: DELTA-based (width-at-grab + pointer travel), not absolute
  // (pointer x − column left). The handle sits 15px past the column's right edge
  // (gap-3 + half the handle), so an absolute model commits width+15 on every
  // no-move CLICK — the first click of a double-click reset walks the 6px handle
  // out from under the second, and the dblclick never fires. Delta-anchored, a
  // click re-commits the SAME width: the geometry holds still through the pair.
  const resizeAnchor = useRef<{ x0: number; w0: number } | null>(null)

  function beginResize(e: React.PointerEvent) {
    if (e.button !== 0) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* no real pointer */ }
    const w0 = effectiveW ?? nameHeadRef.current?.getBoundingClientRect().width ?? NAME_WIDTH_MIN
    resizeAnchor.current = { x0: e.clientX, w0 }
    setDragW(clampNameWidth(w0))
  }
  function moveResize(e: React.PointerEvent) {
    if (dragW === null) return
    if (e.buttons === 0) return endResize(e) // self-heal: capture lost mid-gesture
    const a = resizeAnchor.current
    if (!a) return
    setDragW(clampNameWidth(a.w0 + (e.clientX - a.x0)))
  }
  function endResize(e: React.PointerEvent) {
    if (dragW === null) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already gone */ }
    setNameWidth(dragW)
    setDragW(null)
    resizeAnchor.current = null
  }

  // The version input mounts on menu pick; open the OS picker from this effect
  // (still inside the click's user-activation window) so the flow is one
  // interaction. `n` re-fires the effect on a repeat pick of the same row.
  useEffect(() => { if (versionPick) versionFileRef.current?.click() }, [versionPick])

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

  async function uploadNewVersionFile(doc: DocVM, file: File) {
    setUploading((n) => n + 1)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch(`/api/documents/${doc.id}/versions`, { method: 'POST', body: fd })
      if (r.ok) {
        const dto = (await r.json()) as { latestVersion?: number }
        toast(dto.latestVersion ? `Uploaded v${dto.latestVersion}.` : 'New version uploaded.')
      } else {
        const d = await r.json().catch(() => null)
        toast(d?.message ?? d?.error ?? 'Upload failed.')
      }
    } catch { toast('Upload failed.') } finally {
      setUploading((n) => n - 1)
      if (versionFileRef.current) versionFileRef.current.value = ''
      setVersionPick(null)
    }
    router.refresh()
  }

  async function run(p: Promise<{ ok: boolean; message?: string }>, ok: string) {
    const r = await p
    if (r.ok) { toast(ok); setDialog(null); router.refresh() } else toast(r.message ?? 'Something went wrong.')
  }
  // v0.32: delete confirms via the shared ConfirmDialog (the conversation-menu
  // archive idiom) so the warning can name the version count that goes with
  // the file. The dialog closes once the action settles, success or not — a
  // failed delete surfaces via this toast, not by staying open; the
  // success-branch clear below just front-runs the onClose the dialog fires
  // anyway.
  async function confirmDeleteFile(id: string) {
    const r = await deleteDocumentAction(id)
    if (r.ok) { toast('File deleted.'); setConfirmDelete(null); router.refresh() } else toast(r.message)
  }
  async function delFolder(id: string) {
    const r = await deleteFolderAction(id)
    if (r.ok) { toast('Folder deleted.'); router.refresh() } else toast(r.message)
  }
  function openDialog(d: Dialog) {
    setDialog(d)
    setDialogName('name' in d ? d.name : '')
    // Pre-select the file's OWN folder: since §3.1 the unscoped listing mixes folders,
    // so currentFolderId (null here) is no longer the row's folder — defaulting to it
    // would turn a straight-through "Move" into an accidental move to root.
    if (d.kind === 'movedoc') setMoveTarget(d.folderId ?? '')
  }

  const link = 'flex h-8 items-center gap-2 rounded-md px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
  // The <lg chip form of the same navigation: 36px tall, never shrinking, in one
  // horizontal scroller. It carries NO per-folder Menu — an `overflow-x-auto` ancestor
  // is a hard clip bound for menu.tsx's popover (the listing's own comment below), so
  // folder rename/delete stay on the lg+ rail.
  const chip = 'flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]'
  const chipState = (selected: boolean) => selected ? 'bg-selected font-medium text-[var(--text-accent)]' : 'text-default hover:bg-hover'
  const rows: DocVM[] = hits
    ? hits.map((h) => ({ id: h.id, name: h.name, path: h.path, mime: h.mime, size: 0, uploaderId: '', uploaderName: '', created: '', folderId: null, folderName: null, latestVersion: 1, createdAtIso: '' }))
    : shown

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[13rem_1fr]">
      {/* Folder rail. The per-folder Menu is a SIBLING of the navigation Link (never
          nested inside it) so there is no interactive-inside-interactive a11y violation. */}
      <aside className="hidden space-y-1 lg:block">
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
                { label: 'Delete', danger: true, onSelect: () => setConfirmFolder(f) },
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

      {/* The rail's <lg replacement: the single column stacks it above the listing. */}
      <div className="flex gap-1 overflow-x-auto pb-1 lg:hidden">
        <Link href="/files" aria-current={currentFolderId === null ? 'page' : undefined}
          className={`${chip} ${chipState(currentFolderId === null)}`}>
          <Folder size={15} aria-hidden /> All files
        </Link>
        {folders.map((f) => (
          <Link key={f.id} href={`/files?folder=${f.id}`} aria-current={currentFolderId === f.id ? 'page' : undefined}
            className={`${chip} ${chipState(currentFolderId === f.id)}`}>
            <Folder size={15} aria-hidden /> {f.name}
          </Link>
        ))}
        {mayUpload && (
          <button type="button" onClick={() => openDialog({ kind: 'newfolder' })}
            className={`${chip} text-muted hover:bg-hover hover:text-default`}>
            <FolderPlus size={15} aria-hidden /> New folder
          </button>
        )}
      </div>

      {/* Main: search + upload + table */}
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-2.5">
            <Search size={15} aria-hidden className="shrink-0 text-subtle" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) setHits(null) }} placeholder="Search files by name…"
              aria-label="Search files" className="h-9 w-full bg-transparent text-sm text-default outline-none placeholder:text-subtle" />
          </div>
          {/* F12: pop the current listing (incl. its folder query) into its own window. */}
          <button type="button" aria-label="Open in new window" onClick={() => window.open(window.location.href, '_blank', 'noopener')}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted transition-colors hover:bg-hover hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
            <ExternalLink size={15} aria-hidden />
          </button>
          {/* Wave 18: zip-export of the ticked selection — all roles (guests included). */}
          <button type="button" onClick={exportSelected} disabled={selected.size === 0 || searching}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm text-default transition-colors hover:bg-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
            <Download size={15} aria-hidden /> Export{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
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

        {/* Table (or search results across all folders). The listing card carries
            NO overflow class in the DEFAULT state: menu.tsx positions each row's
            action popover absolutely and treats every clipping ancestor as a hard
            bound, so a clipped listing caps the popover to the (short) list's own
            height — a one-row list collapsed it to a 1px sliver (v0.10.0). A stored
            Name-column width (wave 19) adds overflow-x-auto ONLY while set — in that
            explicit user-chosen state the card becomes a clip ancestor for row menus
            (accepted, user-induced; menu.tsx caps to the card bounds); the wave-18
            clip e2e runs in the default state. Same shape as the issues list
            container (issue-list-view.tsx); rows carry no background of their own,
            so the rounded corners need no clip anyway. */}
        {rows.length === 0 ? (
          <div className="mt-3">
            <EmptyState icon={FileText}
              title={hits ? 'No files match your search' : 'No files here yet'}
              hint={hits ? 'Try a different filename.' : mayUpload ? 'Upload a file or drag one into the drop zone above.' : 'Files uploaded by your lab will appear here.'} />
          </div>
        ) : (
          <div className={`mt-3 rounded-xl border border-border bg-surface shadow-xs${resizing ? ' overflow-x-auto' : ''}`}>
            {!searching && (
              <div className={`flex items-center gap-3 border-b border-border px-3 py-2${resizing ? ' w-max min-w-full' : ''}`}>
                {/* header cells mirror the row cells' widths/breakpoints so the columns align */}
                <input ref={selectAllRef} type="checkbox" checked={allListed} onChange={toggleAll} disabled={documents.length === 0}
                  aria-label="Select all files"
                  className="h-4 w-4 shrink-0 rounded border-border accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
                <span aria-hidden className="w-4 shrink-0" />
                <div ref={nameHeadRef} className="min-w-0 flex-1" style={effectiveW ? { minWidth: effectiveW } : undefined}>
                  <SortButton label="Name" className="w-full"
                    active={sortState?.key === 'name'} dir={sortState?.key === 'name' ? sortState.dir : undefined}
                    onClick={() => setSortState((s) => nextSortState(s, 'name'))} />
                </div>
                {/* Wave 19 resize handle: fine-pointer devices only (the AFFORDANCE is
                    gated, never the layout); Arrow keys nudge ±24, ArrowLeft past the
                    floor or a double-click resets to the default column. */}
                {finePointer && (
                  <button type="button" aria-label="Resize name column (drag or arrow keys; double-click or left arrow past the minimum to reset)"
                    onPointerDown={beginResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize}
                    onDoubleClick={() => setNameWidth(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault()
                        setNameWidth(nudgeNameWidth(effectiveW, e.key === 'ArrowRight' ? 24 : -24))
                      }
                    }}
                    className="h-5 w-1.5 shrink-0 cursor-col-resize touch-none rounded-full transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
                )}
                <SortButton label="Folder" className="hidden w-32 sm:flex"
                  active={sortState?.key === 'folder'} dir={sortState?.key === 'folder' ? sortState.dir : undefined}
                  onClick={() => setSortState((s) => nextSortState(s, 'folder'))} />
                <SortButton label="Size" className="hidden w-16 justify-end sm:flex"
                  active={sortState?.key === 'size'} dir={sortState?.key === 'size' ? sortState.dir : undefined}
                  onClick={() => setSortState((s) => nextSortState(s, 'size'))} />
                <SortButton label="Uploader" className="hidden w-40 md:flex"
                  active={sortState?.key === 'uploader'} dir={sortState?.key === 'uploader' ? sortState.dir : undefined}
                  onClick={() => setSortState((s) => nextSortState(s, 'uploader'))} />
                <SortButton label="Created" className="hidden w-44 lg:flex"
                  active={sortState?.key === 'created'} dir={sortState?.key === 'created' ? sortState.dir : undefined}
                  onClick={() => setSortState((s) => nextSortState(s, 'created'))} />
                {/* Spacer holding the header's trailing column open wherever rows render their action Menu (ICON_TRIGGER w-7). */}
                {documents.some((d) => mayUpload || canDeleteDocument(role, d.uploaderId, selfId)) && (
                  <span aria-hidden className="w-7 shrink-0" />
                )}
              </div>
            )}
            <ul className={`divide-y divide-border${resizing ? ' w-max min-w-full' : ''}`}>
              {rows.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  {!hits && (
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)}
                      aria-label={`Select ${d.name}${d.folderName ? ` (${d.folderName})` : ''}`}
                      className="h-4 w-4 shrink-0 rounded border-border accent-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]" />
                  )}
                  <TypeIcon mime={d.mime} />
                  {/* pdf/image open inline in a new tab; office files download — the serving
                      route sets Content-Disposition, so a single anchor handles both. */}
                <div className="flex min-w-0 flex-1 items-center gap-3" style={effectiveW ? { minWidth: effectiveW } : undefined}>
                  {/* `py-1` lifts the row's primary link to a ~26px tap target (the row's
                      action Menu trigger is already 28px, ICON_TRIGGER's h-7). The title
                      carries the full name — the anchor truncates (version-history-drawer idiom). */}
                  <a href={d.path} target="_blank" rel="noreferrer" title={d.name}
                    className="min-w-0 flex-1 truncate py-1 text-default hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">{d.name}</a>
                  {/* v0.32: version chip only once history exists (the certifications-badge shape). */}
                  {!hits && d.latestVersion > 1 && (
                    <span className="inline-flex shrink-0 items-center rounded-full border border-border px-1.5 py-0.5 text-2xs text-subtle">v{d.latestVersion}</span>
                  )}
                </div>
                  {/* SP8 §3.1: the unscoped listing mixes folders, so the row names its folder ('—' at root). */}
                  {!hits && <span className="hidden w-32 shrink-0 truncate text-subtle sm:block">{d.folderName ?? '—'}</span>}
                  {!hits && <span className="hidden w-16 shrink-0 text-right tabular-nums text-subtle sm:block">{fmtSize(d.size)}</span>}
                  {!hits && <span className="hidden w-40 shrink-0 truncate text-muted md:block">{d.uploaderName}</span>}
                  {!hits && <span className="hidden w-44 shrink-0 truncate text-subtle lg:block">{d.created}</span>}
                  {!hits && (mayUpload || canDeleteDocument(role, d.uploaderId, selfId)) && (
                    <Menu label={`File ${d.name} actions`} button={<MoreHorizontal size={16} aria-hidden />} items={[
                      ...(mayUpload && canModifyDocument(role, d.uploaderId, selfId) ? [
                        { label: 'Rename', onSelect: () => openDialog({ kind: 'renamedoc', id: d.id, name: d.name }) },
                        { label: 'Move…', onSelect: () => openDialog({ kind: 'movedoc', id: d.id, name: d.name, folderId: d.folderId }) },
                        { label: 'Upload new version…', onSelect: () => setVersionPick({ doc: d, n: Date.now() }) },
                      ] : []),
                      { label: 'History', onSelect: () => setHistoryFor(d) },
                      { label: 'Download', onSelect: () => window.open(d.path, '_blank', 'noopener') },
                      ...(canDeleteDocument(role, d.uploaderId, selfId) ? [{ label: 'Delete', danger: true, onSelect: () => setConfirmDelete(d) }] : []),
                    ]} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Dialogs */}
      {/* The pending version pick's hidden input — mounted ONLY while a pick is
          pending (see the versionPick comment above). */}
      {versionPick && (
        <input ref={versionFileRef} type="file" hidden aria-label={`Version file for ${versionPick.doc.name}`}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadNewVersionFile(versionPick.doc, f) }} />
      )}
      {historyFor && (
        <VersionHistoryDrawer docId={historyFor.id} docName={historyFor.name} uploaderId={historyFor.uploaderId}
          role={role} selfId={selfId} onClose={() => setHistoryFor(null)} />
      )}
      <ConfirmDialog open={confirmDelete !== null} danger title="Delete file?"
        body={confirmDelete && <>Delete {confirmDelete.name} and its {confirmDelete.latestVersion} version{confirmDelete.latestVersion === 1 ? '' : 's'}? This cannot be undone.</>}
        confirmLabel="Delete"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDeleteFile((confirmDelete ?? { id: '' }).id)} />
      <ConfirmDialog open={confirmFolder !== null} danger title="Delete this folder?"
        body="It must be empty." confirmLabel="Delete"
        onClose={() => setConfirmFolder(null)}
        onConfirm={() => delFolder((confirmFolder ?? { id: '' }).id)} />
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

function SortButton({ label, onClick, active, dir, className }: {
  label: string; onClick: () => void; active: boolean; dir?: 'asc' | 'desc'; className?: string
}) {
  const state = active && dir === 'asc' ? ', ascending (active)' : active && dir === 'desc' ? ', descending (active)' : ', ascending'
  return (
    <button type="button" onClick={onClick} aria-label={`Sort by ${label.toLowerCase()}${state}`}
      className={`flex items-center gap-1 text-2xs font-medium text-subtle transition-colors hover:text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] ${className ?? ''}`}>
      {label}
      {active && (dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />)}
    </button>
  )
}
