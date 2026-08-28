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

export async function submitRaAcknowledgment(
  user: SessionUser, input: { documentId: string; matricNumber: string },
): Promise<RaAcknowledgmentDto> {
  assertCanSubmitRa(user.role)
  // Type guards first: this is an RPC boundary — a forged non-string must degrade
  // to PolicyError, never a TypeError 500.
  if (typeof input.documentId !== 'string' || typeof input.matricNumber !== 'string') {
    throw new PolicyError('invalid', 'Invalid acknowledgment.')
  }
  const matric = input.matricNumber.trim()
  if (!matric || matric.length > MATRIC_MAX) {
    throw new PolicyError('invalid', 'Enter your matriculation number (at most 32 characters).')
  }
  const folderId = await raFolderId()
  if (!folderId) throw new PolicyError('invalid', 'No RA folder exists yet — an admin creates it in Files.')
  const doc = await prisma.document.findUnique({ where: { id: input.documentId }, select: { id: true, name: true, folderId: true } })
  if (!doc || doc.folderId !== folderId) throw new PolicyError('invalid', 'Pick an RA document from the list.')
  try {
    const row = await prisma.raAcknowledgment.create({
      data: { userId: user.id, documentId: doc.id, documentName: doc.name, matricNumber: matric },
      include: { user: AUTHOR_SELECT },
    })
    return toDto(row)
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      throw new PolicyError('invalid', 'You have already acknowledged this RA.')
    }
    throw e
  }
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
  await prisma.raAcknowledgment.delete({ where: { id: row.id } })
}
