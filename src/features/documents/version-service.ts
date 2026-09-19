import 'server-only'
import type { Role } from '@/lib/session'
import { prisma } from '@/lib/db'
import { copyUpload } from '@/lib/uploads'
import * as bot from '@/features/bot'
import { PolicyError, assertCanModifyDocument } from './documents-policy'
import { assertDocumentPath, toDto } from './document-service'
import type { DocumentDto } from './document-service'

// v0.32 file versioning. History is strictly LINEAR: uploading or restoring
// always appends version latestVersion + 1 — nothing is ever rewound or
// branched, so a shared path/name/mime snapshot exists for every point in a
// file's life. The Document row stays the "current" pointer (path/size/etc.
// mirror the newest version; latestVersion is denormalized for listings).

export type VersionDto = { id: string; version: number; name: string; mime: string; size: number; uploadedByName: string; createdAt: Date }

async function getDocOrThrow(id: string) {
  const doc = await prisma.document.findUnique({ where: { id } })
  if (!doc) throw new PolicyError('not_found', 'File not found.')
  return doc
}

// The file must already be on the volume at a SERVER-minted documents path
// (saveUpload / copyUpload); this only re-points the Document row and appends
// the snapshot. Same uploader-or-admin posture as rename/move.
export async function uploadNewVersion(args: {
  documentId: string; uploaderId: string; role: Role; name: string; path: string; mime: string; size: number
}): Promise<DocumentDto> {
  assertDocumentPath(args.path)
  const doc = await getDocOrThrow(args.documentId)
  assertCanModifyDocument(args.role, doc.uploaderId, args.uploaderId)
  const version = doc.latestVersion + 1
  const name = args.name.slice(0, 200)
  const updated = await prisma.$transaction(async (tx) => {
    await tx.documentVersion.create({ data: { documentId: doc.id, version, path: args.path, name, mime: args.mime, size: args.size, uploadedById: args.uploaderId } })
    return tx.document.update({
      where: { id: doc.id },
      data: { latestVersion: version, path: args.path, name, mime: args.mime, size: args.size },
      include: { uploader: { select: { name: true } }, folder: { select: { name: true } } },
    })
  })
  // §6.9 posture: posted, not pinged; awaited but non-fatal (announceToChannel
  // is internally try/caught) — same one-liner shape as createDocument.
  await bot.announceToChannel(`File updated: ${name} (v${version}) — by ${updated.uploader.name}`, args.uploaderId)
  return toDto(updated)
}

// Newest first — the version drawer (Task 5) renders top-down from current.
export async function listVersions(documentId: string): Promise<VersionDto[]> {
  const rows = await prisma.documentVersion.findMany({
    where: { documentId }, orderBy: { version: 'desc' },
    include: { uploadedBy: { select: { name: true } } },
  })
  return rows.map((r) => ({ id: r.id, version: r.version, name: r.name, mime: r.mime, size: r.size, uploadedByName: r.uploadedBy.name, createdAt: r.createdAt }))
}

// Restore = copy the old bytes to a FRESH path and register them as the NEXT
// version. The original snapshot row is never touched, so history stays linear
// and restorable versions remain restorable.
export async function restoreVersion(args: { versionId: string; userId: string; role: Role }): Promise<DocumentDto> {
  const v = await prisma.documentVersion.findUnique({ where: { id: args.versionId }, include: { document: true } })
  if (!v) throw new PolicyError('not_found', 'Version not found.')
  assertCanModifyDocument(args.role, v.document.uploaderId, args.userId)
  if (v.version === v.document.latestVersion) throw new PolicyError('invalid', 'That version is already the latest.')
  const newPath = await copyUpload(v.path)
  return uploadNewVersion({ documentId: v.documentId, uploaderId: args.userId, role: args.role, name: v.name, path: newPath, mime: v.mime, size: v.size })
}
