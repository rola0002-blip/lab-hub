import 'server-only'
import { prisma } from '@/lib/db'
import { readUpload } from '@/lib/uploads'
import { buildStoredZip, zipEntryName } from './zip'

// Caller (the route) owns the session gate — read/download is ANY authenticated
// role incl. guests (documents-policy.ts:10 posture); this service assumes an
// authorized caller (the equipment export-service precedent). Resolves rows in the
// CALLER'S id order, skips rows deleted since render and files missing on disk
// (an export is a read, not an audit — partial success beats a 500), and returns
// null when nothing resolves. Total-bytes guard is 1 GiB: ZIP32 ceilings at 4 GiB
// and 1 GiB is ~34x the current whole library — streaming is the documented
// follow-up, not code.
export type DocumentsExport = { filename: string; body: Buffer } | { tooLarge: true }
export async function buildDocumentsZip(ids: string[]): Promise<DocumentsExport | null> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return null
  const rows = await prisma.document.findMany({
    where: { id: { in: unique } },
    include: { folder: { select: { name: true } } },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const total = unique.reduce((n, id) => n + (byId.get(id)?.size ?? 0), 0)
  if (total > 1024 * 1024 * 1024) return { tooLarge: true }
  const used = new Set<string>()
  const entries: { name: string; data: Buffer }[] = []
  for (const id of unique) {
    const row = byId.get(id)
    if (!row) continue // deleted between render and export — skip, don't fail
    const rel = row.path.replace(/^\/uploads\//, '').split('/')
    const file = await readUpload(rel) // traversal-safe; null when bytes are gone
    if (!file) continue
    entries.push({ name: zipEntryName(row.folder?.name ?? null, row.name, used), data: file.data })
  }
  if (entries.length === 0) return null
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return { filename: `labhub-files-${date}.zip`, body: buildStoredZip(entries) }
}
