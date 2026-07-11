import 'server-only'
import type { Role } from '@/lib/session'
import { prisma } from '@/lib/db'
import { emitEvent, hasLiveConnection } from '@/lib/events'
import { notify } from '@/lib/notify'
import { issueCommentEmail, issueMentionEmail } from '@/lib/email/templates'
import { parseMentions } from '@/features/chat/mentions'
import { assertCanMutate, canEditComment, canDeleteComment, PolicyError } from './issue-policy'
import { formatIdentifier } from './identifier'

export type CommentDto = {
  id: string; issueId: string; body: string; deleted: boolean
  author: { id: string; name: string; image: string | null }
  mentionUserIds: string[]; editedAt: string | null; createdAt: string
}

const AUTHOR_SELECT = { select: { id: true, name: true, image: true } } as const

async function orgName(): Promise<string> {
  return (await prisma.organization.findFirst())?.name ?? 'COLOSSUS'
}

export async function createComment(args: { actorId: string; role: Role; issueId: string; body: string }): Promise<CommentDto> {
  assertCanMutate(args.role)
  const issue = await prisma.issue.findUnique({ where: { id: args.issueId }, select: { id: true, number: true, title: true, creatorId: true, assigneeId: true } })
  if (!issue) throw new PolicyError('not_found', 'Issue not found.')
  const body = args.body.trim().slice(0, 8000)
  if (!body) throw new PolicyError('invalid', 'Comment cannot be empty.')
  const mentionUserIds = parseMentions(body).userIds
  const comment = await prisma.issueComment.create({ data: { issueId: issue.id, userId: args.actorId, body, mentionUserIds }, include: { user: AUTHOR_SELECT } })
  await emitEvent({ t: 'issue_comment', issueId: issue.id })

  const actor = await prisma.user.findUnique({ where: { id: args.actorId }, select: { name: true } })
  const id = formatIdentifier(issue.number)
  const preview = body.slice(0, 120)
  const org = await orgName()
  const notified = new Set<string>([args.actorId]) // never self
  // Mentions take precedence over the creator/assignee comment ping (no duplicate).
  for (const uid of mentionUserIds) {
    if (notified.has(uid)) continue
    notified.add(uid)
    const email = hasLiveConnection(uid) ? undefined : issueMentionEmail(org, actor?.name ?? 'Someone', id, 'a comment', issue.title)
    await notify(uid, 'issue_mention', { message: `${actor?.name ?? 'Someone'} mentioned you on ${id}`, issueId: issue.id, identifier: id }, email)
  }
  for (const uid of [issue.creatorId, issue.assigneeId]) {
    if (!uid || notified.has(uid)) continue
    notified.add(uid)
    const email = hasLiveConnection(uid) ? undefined : issueCommentEmail(org, actor?.name ?? 'Someone', id, issue.title, preview)
    await notify(uid, 'issue_comment', { message: `${actor?.name ?? 'Someone'} commented on ${id}: ${preview}`, issueId: issue.id, identifier: id }, email)
  }
  return toDto(comment)
}

export async function editComment(args: { actorId: string; role: Role; commentId: string; body: string }): Promise<CommentDto> {
  const c = await prisma.issueComment.findUnique({ where: { id: args.commentId } })
  if (!c || c.deletedAt) throw new PolicyError('not_found', 'Comment not found.')
  if (!canEditComment(args.role, c.userId, args.actorId)) throw new PolicyError('forbidden', 'You can only edit your own comments.')
  const body = args.body.trim().slice(0, 8000)
  if (!body) throw new PolicyError('invalid', 'Comment cannot be empty.')
  const updated = await prisma.issueComment.update({
    where: { id: c.id }, data: { body, editedAt: new Date(), mentionUserIds: parseMentions(body).userIds }, include: { user: AUTHOR_SELECT },
  })
  await emitEvent({ t: 'issue_comment', issueId: c.issueId })
  return toDto(updated)
}

export async function deleteComment(args: { actorId: string; role: Role; commentId: string }): Promise<void> {
  const c = await prisma.issueComment.findUnique({ where: { id: args.commentId } })
  if (!c || c.deletedAt) throw new PolicyError('not_found', 'Comment not found.')
  if (!canDeleteComment(args.role, c.userId, args.actorId)) throw new PolicyError('forbidden', 'You can only delete your own comments.')
  await prisma.issueComment.update({ where: { id: c.id }, data: { deletedAt: new Date(), body: '', mentionUserIds: [] } })
  await emitEvent({ t: 'issue_comment', issueId: c.issueId })
}

function toDto(c: { id: string; issueId: string; body: string; deletedAt: Date | null; mentionUserIds: string[]; editedAt: Date | null; createdAt: Date; user: { id: string; name: string; image: string | null } }): CommentDto {
  return {
    id: c.id, issueId: c.issueId, body: c.deletedAt ? '' : c.body, deleted: !!c.deletedAt,
    author: { id: c.user.id, name: c.user.name, image: c.user.image },
    mentionUserIds: c.mentionUserIds, editedAt: c.editedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
  }
}

// ── merged comment + activity timeline (detail view) ──────────────────────────
export type TimelineEntry =
  | { kind: 'comment'; id: string; createdAt: string; comment: CommentDto }
  | { kind: 'activity'; id: string; createdAt: string; type: string; actor: { id: string; name: string; image: string | null }; data: unknown }

export async function listTimeline(issueId: string): Promise<TimelineEntry[]> {
  const [comments, activities] = await Promise.all([
    prisma.issueComment.findMany({ where: { issueId }, orderBy: { createdAt: 'asc' }, include: { user: AUTHOR_SELECT } }),
    prisma.issueActivity.findMany({ where: { issueId }, orderBy: { createdAt: 'asc' }, include: { actor: AUTHOR_SELECT } }),
  ])
  const entries: TimelineEntry[] = [
    ...comments.map((c) => ({ kind: 'comment' as const, id: c.id, createdAt: c.createdAt.toISOString(), comment: toDto(c) })),
    ...activities.map((a) => ({ kind: 'activity' as const, id: a.id, createdAt: a.createdAt.toISOString(), type: a.type, actor: { id: a.actor.id, name: a.actor.name, image: a.actor.image }, data: a.data })),
  ]
  return entries.sort((x, y) => (x.createdAt < y.createdAt ? -1 : x.createdAt > y.createdAt ? 1 : x.kind === 'activity' ? -1 : 1))
}
