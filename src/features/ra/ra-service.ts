import 'server-only'
import type { Prisma } from '@prisma/client'
import type { SessionUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { RA_FOLDER_NAME, PolicyError, assertCanSubmitRa, assertCanReviewRa, assertCanRevokeRaAcknowledgment } from './ra-policy'

// RA acknowledgments (wave 9): silent by design — no bell, no announce, no SSE
// (revalidatePath + router.refresh, the Files posture). documentName is snapshotted
// at submit so the record outlives the Files document.

export type RaAcknowledgmentDto = {
  id: string
  documentId: string
  documentName: string
  matricNumber: string
  createdAt: string // ISO — the MessageDto/FeedbackDto convention
  author: { id: string; name: string; email: string }
}

const AUTHOR_SELECT = { select: { id: true, name: true, email: true } } as const
const MATRIC_MAX = 32
// createdAt + id tiebreak — the FEEDBACK_ORDER precedent (a total order even
// when two rows land in the same millisecond).
const RA_ORDER: Prisma.RaAcknowledgmentOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }]

function toDto(r: {
  id: string; documentId: string; documentName: string; matricNumber: string; createdAt: Date
  user: { id: string; name: string; email: string }
}): RaAcknowledgmentDto {
  return {
    id: r.id, documentId: r.documentId, documentName: r.documentName, matricNumber: r.matricNumber,
    createdAt: r.createdAt.toISOString(), author: { id: r.user.id, name: r.user.name, email: r.user.email },
  }
}

async function raFolderId(): Promise<string | null> {
  const folder = await prisma.documentFolder.findUnique({ where: { name: RA_FOLDER_NAME }, select: { id: true } })
  return folder?.id ?? null
}

// The dropdown source: the RA folder's documents + which ones this user has
// already acknowledged (the UI disables those).
export async function raOptions(user: SessionUser): Promise<{
  folderExists: boolean
  documents: { id: string; name: string }[]
  acknowledgedDocumentIds: string[]
}> {
  assertCanSubmitRa(user.role)
  const folderId = await raFolderId()
  if (!folderId) return { folderExists: false, documents: [], acknowledgedDocumentIds: [] }
  const [documents, mine] = await Promise.all([
    prisma.document.findMany({ where: { folderId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true } }),
    prisma.raAcknowledgment.findMany({ where: { userId: user.id }, select: { documentId: true } }),
  ])
  return { folderExists: true, documents, acknowledgedDocumentIds: mine.map((m) => m.documentId) }
}

// Wave 19: bulk submit — tick N RAs, one matric, one call. Replaces the single-doc
// fn (the checkbox UI is its only caller). Same silent-by-design posture.
export async function submitRaAcknowledgments(
  user: SessionUser, input: { documentIds: string[]; matricNumber: string },
): Promise<{ recorded: number }> {
  assertCanSubmitRa(user.role)
  // Type guards first: this is an RPC boundary — a forged non-array or non-string
  // must degrade to PolicyError, never a TypeError 500.
  if (!Array.isArray(input.documentIds)
    || input.documentIds.some((id) => typeof id !== 'string')
    || typeof input.matricNumber !== 'string') {
    throw new PolicyError('invalid', 'Invalid acknowledgment.')
  }
  const matric = input.matricNumber.trim()
  if (!matric || matric.length > MATRIC_MAX) {
    throw new PolicyError('invalid', 'Enter your matriculation number (at most 32 characters).')
  }
  const ids = [...new Set(input.documentIds)]
  if (ids.length === 0) throw new PolicyError('invalid', 'Pick at least one RA document.')
  if (ids.length > 100) throw new PolicyError('invalid', 'Pick at most 100 RA documents.')
  const folderId = await raFolderId()
  if (!folderId) throw new PolicyError('invalid', 'No RA folder exists yet — an admin creates it in Files.')
  const docs = await prisma.document.findMany({ where: { id: { in: ids }, folderId }, select: { id: true, name: true } })
  // Any id missing, foreign, or outside the RA folder ⇒ generic refusal —
  // nothing was written, and there is no existence leak.
  if (docs.length !== ids.length) throw new PolicyError('invalid', 'Pick RA documents from the list.')
  // One statement, atomic: createMany … ON CONFLICT DO NOTHING — a doc already
  // acknowledged (stale UI, race, re-submit) is skipped, not an error (the
  // grantCertification novelty-probe posture); r.count is what actually landed.
  const r = await prisma.raAcknowledgment.createMany({
    data: docs.map((d) => ({ userId: user.id, documentId: d.id, documentName: d.name, matricNumber: matric })),
    skipDuplicates: true,
  })
  return { recorded: r.count }
}

export async function listMyRaAcknowledgments(user: SessionUser): Promise<RaAcknowledgmentDto[]> {
  assertCanSubmitRa(user.role)
  const rows = await prisma.raAcknowledgment.findMany({
    where: { userId: user.id }, orderBy: RA_ORDER, include: { user: AUTHOR_SELECT },
  })
  return rows.map(toDto)
}

export async function listAllRaAcknowledgments(user: SessionUser): Promise<RaAcknowledgmentDto[]> {
  assertCanReviewRa(user.role) // permission before existence: no id leak
  const rows = await prisma.raAcknowledgment.findMany({ orderBy: RA_ORDER, include: { user: AUTHOR_SELECT } })
  return rows.map(toDto)
}

// Hard delete (wave 10 D2): the wrongly-added use case. The (userId, documentId)
// unique frees with the row, so the user can re-acknowledge afterwards.
export async function revokeRaAcknowledgment(user: SessionUser, id: string): Promise<void> {
  // RPC guard first: a forged non-string id must degrade to PolicyError.
  if (typeof id !== 'string') throw new PolicyError('invalid', 'Invalid acknowledgment.')
  const row = await prisma.raAcknowledgment.findUnique({ where: { id }, select: { id: true, userId: true } })
  if (!row) throw new PolicyError('not_found', 'Acknowledgment not found.')
  assertCanRevokeRaAcknowledgment(user, row)
  try {
    await prisma.raAcknowledgment.delete({ where: { id: row.id } })
  } catch (e) {
    // Concurrent revoke: the row vanished between load and delete — the repo
    // bars untranslated Prisma codes from reaching the client (issue-service
    // deleteLabel pattern); for the user this is simply "already gone".
    if ((e as { code?: string }).code === 'P2025') throw new PolicyError('not_found', 'Acknowledgment not found.')
    throw e
  }
}
