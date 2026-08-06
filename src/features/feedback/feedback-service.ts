import 'server-only'
import type { Prisma, FeedbackStatus as PrismaFeedbackStatus, FeedbackType as PrismaFeedbackType } from '@prisma/client'
import type { SessionUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import { removeUpload } from '@/lib/uploads'
import {
  PolicyError, assertCanSubmitFeedback, assertCanReviewFeedback, assertCanDeleteFeedback,
  isFeedbackStatus, normalizePagePath, type FeedbackStatus,
} from './feedback-policy'
import { checkFeedbackRate } from './rate-limit'

// The feedback brain (spec §6). Bell-only: no email (every notify() call is
// three-arg), no #lab-updates announce, no SSE event — the page refreshes via
// revalidatePath/router.refresh, the Files/SP8/v0.12 posture.

type FeedbackTypeName = 'BUG' | 'IDEA'

// Compile-time bridge, zero runtime cost: each side must extend the other, so an edit
// to Prisma's enums or to the policy's client-safe unions that forgets its twin fails
// the BUILD here rather than drifting silently. The alias is never instantiated —
// TypeScript constraint-checks the default type arguments at the declaration itself.
type _FeedbackEnumsInSync<
  S1 extends PrismaFeedbackStatus = FeedbackStatus,
  S2 extends FeedbackStatus = PrismaFeedbackStatus,
  T1 extends PrismaFeedbackType = FeedbackTypeName,
  T2 extends FeedbackTypeName = PrismaFeedbackType,
> = [S1, S2, T1, T2]

export type FeedbackDto = {
  id: string
  type: FeedbackTypeName
  status: FeedbackStatus
  body: string
  screenshotPath: string | null
  appVersion: string
  pagePath: string
  userAgent: string
  createdAt: string // ISO — the MessageDto convention (widen with new Date() before a Prisma filter)
  author: { id: string; name: string; image: string | null }
}

export type SubmitFeedbackInput = {
  type: FeedbackTypeName
  body: string
  pagePath: string
  screenshotPath?: string | null
  appVersion: string // stamped by the route, never by the client
  userAgent: string  // ditto
}

const AUTHOR_SELECT = { select: { id: true, name: true, image: true } } as const
const BODY_MAX = 4000    // the chat/ProjectUpdate cap, reused
const CONTEXT_MAX = 300  // pagePath + userAgent are captured client-side: store a bounded slice
// Decisions bell the author; REVIEWED is bookkeeping and stays silent (§6.4).
const DECIDED = new Set<FeedbackStatus>(['PLANNED', 'DONE', 'DECLINED'])

// `createdAt` alone is not a total order — two rows can land in the same millisecond
// and Postgres is then free to return them either way. The id tiebreaker makes the
// newest-first read deterministic, and both list functions share THIS tuple so the
// queue and "my feedback" can never order differently (the PROJECT_UPDATE_ORDER precedent).
const FEEDBACK_ORDER: Prisma.FeedbackOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }]

// Assert a screenshot path is one WE minted (saveUpload('feedback') → /uploads/feedback/<uuid><ext>).
// Closes a cross-feature file-reference IDOR — a chat/issue/document/avatar file can
// never be attached to a report. Twin of document-service.ts's assertDocumentPath.
function assertFeedbackPath(path: string): void {
  if (!path.startsWith('/uploads/feedback/') || path.includes('..')) {
    throw new PolicyError('invalid', 'A screenshot must be an uploaded file.')
  }
}

// 'PLANNED' → 'Planned'. Derived from the status constant rather than a hand-kept map,
// so a sixth status needs no copy edit here.
const titleCasedStatus = (s: FeedbackStatus): string => s.charAt(0) + s.slice(1).toLowerCase()

function toDto(f: {
  id: string; type: PrismaFeedbackType; status: PrismaFeedbackStatus; body: string; screenshotPath: string | null
  appVersion: string; pagePath: string; userAgent: string; createdAt: Date
  author: { id: string; name: string; image: string | null }
}): FeedbackDto {
  return {
    id: f.id, type: f.type, status: f.status, body: f.body, screenshotPath: f.screenshotPath,
    appVersion: f.appVersion, pagePath: f.pagePath, userAgent: f.userAgent,
    createdAt: f.createdAt.toISOString(),
    author: { id: f.author.id, name: f.author.name, image: f.author.image },
  }
}

// Hybrid error contract (§6.2), matching chat's: ONLY the limiter returns a result
// object — a 429 has no PolicyError code to map. Every other failure throws.
export async function submitFeedback(
  user: SessionUser, input: SubmitFeedbackInput,
): Promise<{ ok: true; feedback: FeedbackDto } | { ok: false; error: 'rate_limited' }> {
  assertCanSubmitFeedback(user.role)                                  // guests included, by design
  if (!checkFeedbackRate(user.id)) return { ok: false, error: 'rate_limited' }
  const body = input.body.trim()
  if (!body || body.length > BODY_MAX) throw new PolicyError('invalid', 'Feedback needs a few words, and at most 4000 characters.')
  if (input.screenshotPath) assertFeedbackPath(input.screenshotPath)
  const created = await prisma.feedback.create({
    data: {
      type: input.type,
      body,
      pagePath: normalizePagePath(input.pagePath),
      userAgent: input.userAgent.slice(0, CONTEXT_MAX),
      appVersion: input.appVersion,
      screenshotPath: input.screenshotPath ?? null,
      authorId: user.id,
    },
    include: { author: AUTHOR_SELECT },
  })
  // Bell fan-out to every OTHER admin. banned/system rows are excluded like every
  // human enumeration (SP5 §5.6); the author never bells themself. notify() is
  // internally try/caught, so fan-out can never fail the submission.
  const admins = await prisma.user.findMany({ where: { role: 'admin', banned: false, isSystem: false }, select: { id: true } })
  for (const admin of admins) {
    if (admin.id === user.id) continue
    await notify(admin.id, 'feedback_new', { feedbackId: created.id, message: `New feedback from ${user.name}` })
  }
  return { ok: true, feedback: toDto(created) }
}

export async function listMyFeedback(user: SessionUser): Promise<FeedbackDto[]> {
  const rows = await prisma.feedback.findMany({
    where: { authorId: user.id }, orderBy: FEEDBACK_ORDER, include: { author: AUTHOR_SELECT },
  })
  return rows.map(toDto)
}

// Deliberately unpaginated (§2): lab scale, and the queue is filtered by status client-side.
export async function listAllFeedback(user: SessionUser): Promise<FeedbackDto[]> {
  assertCanReviewFeedback(user.role)
  const rows = await prisma.feedback.findMany({ orderBy: FEEDBACK_ORDER, include: { author: AUTHOR_SELECT } })
  return rows.map(toDto)
}

export async function setFeedbackStatus(user: SessionUser, feedbackId: string, status: FeedbackStatus): Promise<FeedbackDto> {
  assertCanReviewFeedback(user.role)                                  // permission before existence: no id leak
  if (!isFeedbackStatus(status)) throw new PolicyError('invalid', 'Unknown feedback status.')
  const row = await prisma.feedback.findUnique({ where: { id: feedbackId }, include: { author: AUTHOR_SELECT } })
  if (!row) throw new PolicyError('not_found', 'Feedback not found.')  // never a P2025 leak
  if (row.status === status) return toDto(row)                         // idempotent: no write, no bell
  const updated = await prisma.feedback.update({
    where: { id: feedbackId }, data: { status }, include: { author: AUTHOR_SELECT },
  })
  if (DECIDED.has(status) && row.authorId !== user.id) {
    await notify(row.authorId, 'feedback_decided', {
      feedbackId, status, message: `Your feedback was marked ${titleCasedStatus(status)}`,
    })
  }
  return toDto(updated)
}

// Silent by design (§6.5): no announce, no activity trail, no bell.
export async function deleteFeedback(user: SessionUser, feedbackId: string): Promise<void> {
  const row = await prisma.feedback.findUnique({
    where: { id: feedbackId }, select: { id: true, authorId: true, status: true, screenshotPath: true },
  })
  if (!row) throw new PolicyError('not_found', 'Feedback not found.')
  assertCanDeleteFeedback(user, row)
  await prisma.feedback.delete({ where: { id: feedbackId } })
  // Best-effort unlink: a failed file removal never fails the delete (the v0.11
  // issue-delete idiom — the row is already gone, the byte is just litter).
  if (row.screenshotPath) {
    try { await removeUpload(row.screenshotPath) } catch (e) { console.error('feedback screenshot cleanup failed', e) }
  }
}
