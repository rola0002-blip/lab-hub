import { requireUser } from '@/lib/session'
import { getOrg } from '@/lib/org'
import { formatDateTime } from '@/lib/time'
import { listFolders, listDocuments } from '@/features/documents/document-service'
import { PageHeader } from '@/components/page-header'
import { FilesClient } from './files-client'

export default async function FilesPage({ searchParams }: { searchParams: Promise<{ folder?: string }> }) {
  const me = await requireUser()
  const org = await getOrg()
  const tz = org?.timezone ?? 'Asia/Singapore'
  const { folder } = await searchParams
  const folderId = folder ?? null

  // SP8 §3.1: no ?folder= ⇒ omit folderId entirely ⇒ every folder (was root-only).
  const [folders, docs] = await Promise.all([listFolders(), listDocuments(folder ? { folderId: folder } : {})])
  const documents = docs.map((d) => ({
    id: d.id, name: d.name, path: d.path, mime: d.mime, size: d.size,
    uploaderId: d.uploaderId, uploaderName: d.uploaderName, created: formatDateTime(d.createdAt, tz), folderId: d.folderId, folderName: d.folderName,
    latestVersion: d.latestVersion, // v0.32: drives the row's vN chip
    createdAtIso: d.createdAt.toISOString(), // wave 18: sortable raw value — the formatted `created` mis-sorts
  }))
  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Files" />
      <FilesClient folders={folders} documents={documents} currentFolderId={folderId} role={me.role} selfId={me.id} />
    </div>
  )
}
