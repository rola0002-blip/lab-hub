import 'server-only'
import { Prisma } from '@prisma/client'
import type { Role } from '@/lib/session'
import { prisma } from '@/lib/db'
import { removeUpload } from '@/lib/uploads'
import * as bot from '@/features/bot'
import { PolicyError, assertCanUpload, assertCanDeleteDocument, assertCanManageFolder } from './documents-policy'

export type DocumentDto = {
  id: string; folderId: string | null; folderName: string | null; name: string; path: string; mime: string; size: number
  uploaderId: string; uploaderName: string; createdAt: Date
}
export type FolderDto = { id: string; name: string; createdById: string }

const NAME_MAX = 200 // the IssueAttachment name.slice(0, 200) precedent

// Assert a document path is one WE minted (saveUpload('documents') → /uploads/documents/<uuid>.<ext>).
// Closes a cross-feature file-reference IDOR — a chat/issue/avatar file can never be
// registered as a document. Mirrors attachIssueFiles (issue-service.ts:347–355).
function assertDocumentPath(path: string): void {
  if (!path.startsWith('/uploads/documents/') || path.includes('..')) {
    throw new PolicyError('invalid', 'A document must be an uploaded file.')
  }
}

async function assertFolderExists(folderId: string): Promise<{ id: string; name: string }> {
  const folder = await prisma.documentFolder.findUnique({ where: { id: folderId }, select: { id: true, name: true } })
  if (!folder) throw new PolicyError('invalid', 'That folder no longer exists.')
  return folder
}

// One-shot create: the row is created after the file is saved by the route. Server-
// minted path only. Non-fatally announces to #lab-updates (§6.9) after the commit.
export async function createDocument(args: {
  uploaderId: string; uploaderName: string; name: string; path: string; mime: string; size: number; folderId: string | null
}): Promise<DocumentDto> {
  assertDocumentPath(args.path)
  const folder = args.folderId ? await assertFolderExists(args.folderId) : null
  const name = args.name.slice(0, NAME_MAX)
  const doc = await prisma.document.create({
    data: { folderId: folder?.id ?? null, name, path: args.path, mime: args.mime, size: args.size, uploaderId: args.uploaderId },
  })
  // §6.9: one line, uploader + filename + folder (root if none); NO @-mention → posted,
  // not pinged. Awaited but non-fatal (announceToChannel is internally try/caught).
  await bot.announceToChannel(`New file: ${name} (in ${folder?.name ?? 'root'}) — uploaded by ${args.uploaderName}`, args.uploaderId)
  return { ...doc, uploaderName: args.uploaderName, folderName: folder?.name ?? null }
}

export async function renameDocument(args: { userId: string; role: Role; id: string; name: string }): Promise<DocumentDto> {
  assertCanUpload(args.role)
  const doc = await prisma.document.findUnique({ where: { id: args.id }, include: { uploader: { select: { name: true } } } })
  if (!doc) throw new PolicyError('not_found', 'File not found.')
  const updated = await prisma.document.update({ where: { id: args.id }, data: { name: args.name.slice(0, NAME_MAX) }, include: { uploader: { select: { name: true } }, folder: { select: { name: true } } } })
  return toDto(updated)
}

export async function moveDocument(args: { userId: string; role: Role; id: string; folderId: string | null }): Promise<DocumentDto> {
  assertCanUpload(args.role)
  const doc = await prisma.document.findUnique({ where: { id: args.id }, select: { id: true } })
  if (!doc) throw new PolicyError('not_found', 'File not found.')
  if (args.folderId) await assertFolderExists(args.folderId)
  const updated = await prisma.document.update({ where: { id: args.id }, data: { folderId: args.folderId }, include: { uploader: { select: { name: true } }, folder: { select: { name: true } } } })
  return toDto(updated)
}

export async function deleteDocument(args: { userId: string; role: Role; id: string }): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: args.id }, select: { id: true, path: true, uploaderId: true } })
  if (!doc) throw new PolicyError('not_found', 'File not found.')
  assertCanDeleteDocument(args.role, doc.uploaderId, args.userId)
  await prisma.document.delete({ where: { id: args.id } })
  // Best-effort file unlink (the avatar-cleanup precedent, settings/service.ts:50).
  await removeUpload(doc.path)
}

export async function createFolder(args: { userId: string; role: Role; name: string }): Promise<FolderDto> {
  assertCanUpload(args.role)
  const name = args.name.trim()
  if (name.length < 1) throw new PolicyError('invalid', 'Folder name is required.') // spec §6.1/§6.6: names are unique + non-blank; no arbitrary length cap
  try {
    const f = await prisma.documentFolder.create({ data: { name, createdById: args.userId }, select: { id: true, name: true, createdById: true } })
    return f
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new PolicyError('invalid', 'A folder with that name already exists.')
    throw e
  }
}

export async function renameFolder(args: { userId: string; role: Role; id: string; name: string }): Promise<FolderDto> {
  const folder = await prisma.documentFolder.findUnique({ where: { id: args.id }, select: { id: true, createdById: true } })
  if (!folder) throw new PolicyError('not_found', 'Folder not found.')
  assertCanManageFolder(args.role, folder.createdById, args.userId)
  const name = args.name.trim()
  if (name.length < 1) throw new PolicyError('invalid', 'Folder name is required.') // spec §6.1/§6.6: names are unique + non-blank; no arbitrary length cap
  try {
    return await prisma.documentFolder.update({ where: { id: args.id }, data: { name }, select: { id: true, name: true, createdById: true } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new PolicyError('invalid', 'A folder with that name already exists.')
    throw e
  }
}

export async function deleteFolder(args: { userId: string; role: Role; id: string }): Promise<void> {
  const folder = await prisma.documentFolder.findUnique({ where: { id: args.id }, select: { id: true, createdById: true, _count: { select: { documents: true } } } })
  if (!folder) throw new PolicyError('not_found', 'Folder not found.')
  assertCanManageFolder(args.role, folder.createdById, args.userId)
  if (folder._count.documents > 0) throw new PolicyError('invalid', 'Move or delete the files inside this folder first.')
  await prisma.documentFolder.delete({ where: { id: args.id } })
}

export async function listFolders(): Promise<FolderDto[]> {
  return prisma.documentFolder.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, createdById: true } })
}

// SP8 §3.1: an options object replaces the bare folderId. `folderId` OMITTED ⇒ no
// where clause ⇒ every folder (the honest "all files" read the dashboard needs);
// `folderId: null` ⇒ root only (retained); a string ⇒ that folder. `take` bounds
// the dashboard's read. folderName rides along because the unscoped listing mixes
// folders. createdAt stays a Date (consumers format with formatDateTime).
export async function listDocuments(args: { folderId?: string | null; take?: number } = {}): Promise<DocumentDto[]> {
  const rows = await prisma.document.findMany({
    where: args.folderId !== undefined ? { folderId: args.folderId } : {},
    orderBy: { createdAt: 'desc' },
    ...(args.take ? { take: args.take } : {}),
    include: { uploader: { select: { name: true } }, folder: { select: { name: true } } },
  })
  return rows.map(toDto)
}

function toDto(d: { id: string; folderId: string | null; name: string; path: string; mime: string; size: number; uploaderId: string; createdAt: Date; uploader: { name: string }; folder: { name: string } | null }): DocumentDto {
  return { id: d.id, folderId: d.folderId, folderName: d.folder?.name ?? null, name: d.name, path: d.path, mime: d.mime, size: d.size, uploaderId: d.uploaderId, uploaderName: d.uploader.name, createdAt: d.createdAt }
}
