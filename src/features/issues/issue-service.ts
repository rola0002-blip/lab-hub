import 'server-only'
import type { Prisma as P, IssueStatus, IssuePriority } from '@prisma/client'
import type { Role } from '@/lib/session'
import { prisma } from '@/lib/db'
import { emitEvent, hasLiveConnection } from '@/lib/events'
import { notify } from '@/lib/notify'
import {
  issueAssignedEmail, issueMentionEmail, issueDoneEmail,
} from '@/lib/email/templates'
import { parseMentions } from '@/features/chat/mentions'
import { isMember } from '@/features/chat/conversation-service'
import * as bot from '@/features/bot'
import { removeUpload } from '@/lib/uploads'
import { assertCanMutate, assertCanDeleteIssue, PolicyError } from './issue-policy'
import { rankBetween, rebalance, REBALANCE_THRESHOLD } from './rank'
import { formatIdentifier } from './identifier'
import { dueRange, type DueFilter } from './due'
import { nextLabelColor, splitLabelsForProject } from './labels'

export type IssueDto = {
  id: string; number: number; identifier: string; title: string; description: string
  status: IssueStatus; priority: IssuePriority
  assignee: { id: string; name: string; image: string | null } | null
  creator: { id: string; name: string; image: string | null }
  project: { id: string; name: string } | null
  dueDate: string | null; rank: string; completedAt: string | null; originMessageId: string | null
  labels: { id: string; name: string; color: string }[]
  createdAt: string; updatedAt: string
  // SP8: populated by listIssues ONLY — max(latest activity, latest non-deleted comment);
  // mutation returns leave it absent so optimistic results drop the chip until the next
  // server render (§5.2)
  lastTouchedAt?: string
}

export const ISSUE_INCLUDE = {
  assignee: { select: { id: true, name: true, image: true } },
  creator: { select: { id: true, name: true, image: true } },
  project: { select: { id: true, name: true } },
  labels: { include: { label: { select: { id: true, name: true, color: true, projectId: true } } } },
} satisfies P.IssueInclude

type Loaded = P.IssueGetPayload<{ include: typeof ISSUE_INCLUDE }>

export function toDto(i: Loaded): IssueDto {
  return {
    id: i.id, number: i.number, identifier: formatIdentifier(i.number), title: i.title, description: i.description,
    status: i.status, priority: i.priority,
    assignee: i.assignee ? { id: i.assignee.id, name: i.assignee.name, image: i.assignee.image } : null,
    creator: { id: i.creator.id, name: i.creator.name, image: i.creator.image },
    project: i.project ? { id: i.project.id, name: i.project.name } : null,
    dueDate: i.dueDate?.toISOString() ?? null, rank: i.rank, completedAt: i.completedAt?.toISOString() ?? null,
    originMessageId: i.originMessageId,
    labels: i.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
    createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString(),
  }
}

// ── reads ────────────────────────────────────────────────────────────────────
export type IssueFilter = {
  status?: IssueStatus; assigneeId?: string; projectId?: string | null; labelId?: string; priority?: IssuePriority
  due?: DueFilter
}
// `now` is injectable so the due quick-filter is deterministic under test. The due
// filter is a PURE dueDate range (features/issues/due.ts → dueRange), resolved in the
// org timezone; it is orthogonal to the status filter and composes with it, matching
// every other filter param. Org tz is only fetched when a due filter is active.
export async function listIssues(filter: IssueFilter = {}, now: Date = new Date()): Promise<IssueDto[]> {
  const tz = filter.due ? ((await prisma.organization.findFirst({ select: { timezone: true } }))?.timezone ?? 'Asia/Singapore') : null
  const rows = await prisma.issue.findMany({
    where: {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(filter.projectId !== undefined ? { projectId: filter.projectId } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
      ...(filter.labelId ? { labels: { some: { labelId: filter.labelId } } } : {}),
      ...(filter.due && tz ? { dueDate: dueRange(filter.due, now, tz) } : {}),
    },
    orderBy: [{ status: 'asc' }, { rank: 'asc' }], // rank ordered byte-wise (COLLATE "C")
    include: ISSUE_INCLUDE,
  })
  // Hydrated for LIST reads only — mutation returns leave lastTouchedAt absent (§5.2).
  const touched = await lastTouchedByIssue(rows.map((r) => r.id))
  return rows.map((r) => {
    const dto = toDto(r)
    const at = touched.get(r.id)
    return at ? { ...dto, lastTouchedAt: at.toISOString() } : dto
  })
}

// SP8 §5.2: "touched" = max(latest IssueActivity, latest non-deleted IssueComment),
// per issue, for the given ids — the single source of both the stalled chip's input
// (listIssues above) and the weekly prompt job's untouched count (src/lib/jobs.ts),
// so the two can never diverge. Two grouped reads (the listProjects N+1-avoidance
// idiom), both served by the existing [issueId, createdAt] compound indexes.
// Issue.updatedAt is deliberately NOT consulted — a rank-only move or a column
// rebalance touches updatedAt but writes no activity, so it must not clear the chip.
// Ids with neither activity nor a live comment are ABSENT from the map (never
// null-valued): callers read that as "no last touch", which is not stalled.
export async function lastTouchedByIssue(ids: string[]): Promise<Map<string, Date>> {
  const touched = new Map<string, Date>()
  if (ids.length === 0) return touched
  const [acts, comms] = await Promise.all([
    prisma.issueActivity.groupBy({ by: ['issueId'], _max: { createdAt: true }, where: { issueId: { in: ids } } }),
    prisma.issueComment.groupBy({ by: ['issueId'], _max: { createdAt: true }, where: { issueId: { in: ids }, deletedAt: null } }),
  ])
  for (const g of [...acts, ...comms]) {
    const at = g._max.createdAt
    if (!at) continue // unreachable: a group exists only where a row does
    const prev = touched.get(g.issueId)
    if (!prev || at > prev) touched.set(g.issueId, at)
  }
  return touched
}

export async function getIssue(id: string): Promise<IssueDto | null> {
  const i = await prisma.issue.findUnique({ where: { id }, include: ISSUE_INCLUDE })
  return i ? toDto(i) : null
}

async function loadOrThrow(id: string): Promise<Loaded> {
  const i = await prisma.issue.findUnique({ where: { id }, include: ISSUE_INCLUDE })
  if (!i) throw new PolicyError('not_found', 'Issue not found.')
  return i
}

// SP8 §3.2: assert-then-load FK validation, run BEFORE the transaction. A bad id
// previously surfaced as a Prisma P2003 → unhandled 500. The predicate matches
// exactly what the assignee/lead pickers enumerate ({ banned:false, isSystem:false }),
// so the assert can never reject an option the UI offers — and it makes assigning
// work to the LabHub Bot impossible. Guests are deliberately NOT rejected (§3.2).
export async function assertAssigneeExists(id: string): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id }, select: { banned: true, isSystem: true } })
  if (!u || u.banned || u.isSystem) throw new PolicyError('invalid', 'That person is no longer available.')
}
export async function assertProjectExists(id: string): Promise<void> {
  const p = await prisma.project.findUnique({ where: { id }, select: { id: true } })
  if (!p) throw new PolicyError('invalid', 'That project no longer exists.')
}
// Set-valued variant of the same guard: labels arrive as a client-supplied array, so
// ONE forged id used to sink the whole write with a P2003. Ids are deduped before the
// count because `id` is the primary key — count === unique.length iff every id exists.
export async function assertLabelsExist(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return
  const found = await prisma.label.count({ where: { id: { in: unique } } })
  if (found !== unique.length) throw new PolicyError('invalid', 'One or more of those labels no longer exist.')
}

// ── notification helpers (offline-only email; never self) ─────────────────────
async function pushIssueNotif(
  userId: string, type: 'issue_assigned' | 'issue_mention' | 'issue_comment' | 'issue_done',
  message: string, issueId: string, identifier: string, email: { subject: string; html: string },
): Promise<void> {
  const offline = !hasLiveConnection(userId)
  await notify(userId, type, { message, issueId, identifier }, offline ? email : undefined)
}

async function orgName(): Promise<string> {
  return (await prisma.organization.findFirst())?.name ?? 'LabHub'
}

// New description/comment mentions minus a baseline set and the actor → notify.
async function notifyNewMentions(args: {
  actorId: string; issueId: string; identifier: string; title: string; where: string
  before: string[]; after: string[]
}): Promise<void> {
  const seen = new Set(args.before)
  const fresh = args.after.filter((id) => !seen.has(id) && id !== args.actorId)
  if (fresh.length === 0) return
  const actor = await prisma.user.findUnique({ where: { id: args.actorId }, select: { name: true } })
  const org = await orgName()
  for (const uid of fresh) {
    await pushIssueNotif(uid, 'issue_mention', `${actor?.name ?? 'Someone'} mentioned you on ${args.identifier}`,
      args.issueId, args.identifier, issueMentionEmail(org, actor?.name ?? 'Someone', args.identifier, args.where, args.title))
  }
}

// ── create ───────────────────────────────────────────────────────────────────
export async function createIssue(args: {
  actorId: string; role: Role; title: string; description?: string
  status?: IssueStatus; priority?: IssuePriority; assigneeId?: string | null
  projectId?: string | null; dueDate?: Date | null; labelIds?: string[]
  originMessageId?: string | null
}): Promise<IssueDto> {
  assertCanMutate(args.role)
  const title = args.title.trim()
  if (title.length < 1 || title.length > 200) throw new PolicyError('invalid', 'Title must be 1–200 characters.')
  const status = args.status ?? 'BACKLOG'
  const description = (args.description ?? '').slice(0, 20000)
  // Origin backlink (create-from-message): the client supplies originMessageId, so
  // validate the actor can actually read that message's conversation before storing
  // the link — otherwise a forged id could attach an issue to (and later surface the
  // NAME of) a private channel the actor is not in. A missing message and a
  // non-member both raise the SAME not_found (assert-then-load; no existence leak).
  if (args.originMessageId) {
    const msg = await prisma.message.findUnique({ where: { id: args.originMessageId }, select: { conversationId: true } })
    if (!msg || !(await isMember(args.actorId, msg.conversationId))) throw new PolicyError('not_found', 'Message not found.')
  }
  // `!= null` not truthiness: '' is falsy but IS written (`args.assigneeId ?? null`
  // keeps it), so a truthy guard would let the empty string reach the FK → P2003.
  if (args.assigneeId != null) await assertAssigneeExists(args.assigneeId)
  if (args.projectId != null) await assertProjectExists(args.projectId)
  const wantedIds = [...new Set(args.labelIds ?? [])] // deduped like setLabels: @@unique([issueId,labelId])
  await assertLabelsExist(wantedIds)
  // F5: labels scoped to ANOTHER project can't ride along — keep only what
  // belongs on the destination project (globals + that project's own).
  const loaded = wantedIds.length
    ? await prisma.label.findMany({ where: { id: { in: wantedIds } }, select: { id: true, name: true, color: true, projectId: true } })
    : []
  const labelIds = splitLabelsForProject(loaded, args.projectId ?? null).keep.map((l) => l.id)
  // Initial rank = end of the destination column.
  const last = await prisma.issue.findFirst({ where: { status }, orderBy: { rank: 'desc' }, select: { rank: true } })
  const rank = rankBetween(last?.rank ?? null, null)

  const created = await prisma.$transaction(async (tx) => {
    const issue = await tx.issue.create({
      data: {
        title, description, status, priority: args.priority ?? 'NONE',
        assigneeId: args.assigneeId ?? null, creatorId: args.actorId,
        projectId: args.projectId ?? null, dueDate: args.dueDate ?? null, rank,
        completedAt: status === 'DONE' ? new Date() : null,
        originMessageId: args.originMessageId ?? null,
        labels: { create: labelIds.map((labelId) => ({ labelId })) },
      },
      include: ISSUE_INCLUDE,
    })
    await tx.issueActivity.create({ data: { issueId: issue.id, actorId: args.actorId, type: 'created', data: { status } } })
    return issue
  })

  await emitEvent({ t: 'issue', id: created.id, projectId: created.projectId ?? undefined })
  const dto = toDto(created)
  void bot.announceToChannel(`New issue ${dto.identifier}: ${dto.title}`, args.actorId)
  // Mention-wins de-dup (matches comment-service): if the assignee is also @-mentioned
  // in the description, the mention notification covers them — don't also fire
  // issue_assigned (one create → one notification for that user), never self.
  const mentionIds = parseMentions(description).userIds
  if (args.assigneeId && args.assigneeId !== args.actorId && !mentionIds.includes(args.assigneeId)) {
    const actor = await prisma.user.findUnique({ where: { id: args.actorId }, select: { name: true } })
    await pushIssueNotif(args.assigneeId, 'issue_assigned', `${actor?.name ?? 'Someone'} assigned you ${dto.identifier}`,
      created.id, dto.identifier, issueAssignedEmail(await orgName(), actor?.name ?? 'Someone', dto.identifier, title))
  }
  await notifyNewMentions({
    actorId: args.actorId, issueId: created.id, identifier: dto.identifier, title, where: 'the description',
    before: [], after: mentionIds,
  })
  return dto
}

// ── status (+ completedAt + issue_done) ───────────────────────────────────────
async function applyStatus(tx: P.TransactionClient, issue: Loaded, actorId: string, status: IssueStatus): Promise<Loaded> {
  const completedAt = status === 'DONE' ? (issue.completedAt ?? new Date()) : issue.status === 'DONE' ? null : issue.completedAt
  const u = await tx.issue.update({ where: { id: issue.id }, data: { status, completedAt }, include: ISSUE_INCLUDE })
  await tx.issueActivity.create({ data: { issueId: issue.id, actorId, type: 'status', data: { from: issue.status, to: status } } })
  return u
}
async function maybeNotifyDone(issue: Loaded, prevStatus: IssueStatus, status: IssueStatus, actorId: string): Promise<void> {
  if (status === 'DONE' && prevStatus !== 'DONE') {
    const id = formatIdentifier(issue.number)
    void bot.announceToChannel(`${id} done: ${issue.title}`, actorId)
    if (issue.creatorId !== actorId) {
      const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
      await pushIssueNotif(issue.creatorId, 'issue_done', `${actor?.name ?? 'Someone'} completed ${id}`,
        issue.id, id, issueDoneEmail(await orgName(), actor?.name ?? 'Someone', id, issue.title))
    }
  }
}

export async function setStatus(args: { actorId: string; role: Role; issueId: string; status: IssueStatus }): Promise<IssueDto> {
  assertCanMutate(args.role)
  const issue = await loadOrThrow(args.issueId)
  if (issue.status === args.status) return toDto(issue)
  const updated = await prisma.$transaction((tx) => applyStatus(tx, issue, args.actorId, args.status))
  await emitEvent({ t: 'issue', id: issue.id, projectId: updated.projectId ?? undefined })
  await maybeNotifyDone(issue, issue.status, args.status, args.actorId)
  return toDto(updated)
}

// ── assignee (+ issue_assigned) ───────────────────────────────────────────────
export async function setAssignee(args: { actorId: string; role: Role; issueId: string; assigneeId: string | null }): Promise<IssueDto> {
  assertCanMutate(args.role)
  if (args.assigneeId != null) await assertAssigneeExists(args.assigneeId) // §3.2; only null clears — '' is a bad id, not a clear
  const issue = await loadOrThrow(args.issueId)
  if (issue.assigneeId === args.assigneeId) return toDto(issue)
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.issue.update({ where: { id: issue.id }, data: { assigneeId: args.assigneeId }, include: ISSUE_INCLUDE })
    await tx.issueActivity.create({ data: { issueId: issue.id, actorId: args.actorId, type: 'assignee', data: { from: issue.assigneeId, to: args.assigneeId } } })
    return u
  })
  await emitEvent({ t: 'issue', id: issue.id, projectId: updated.projectId ?? undefined })
  if (args.assigneeId && args.assigneeId !== args.actorId) {
    const actor = await prisma.user.findUnique({ where: { id: args.actorId }, select: { name: true } })
    const id = formatIdentifier(issue.number)
    await pushIssueNotif(args.assigneeId, 'issue_assigned', `${actor?.name ?? 'Someone'} assigned you ${id}`,
      issue.id, id, issueAssignedEmail(await orgName(), actor?.name ?? 'Someone', id, issue.title))
  }
  return toDto(updated)
}

// ── simple field setters (priority / project / dueDate / title) ───────────────
// Callers assert permission FIRST, then load the issue exactly once and pass it in
// (assert-then-load): a guest probing a missing id always gets `forbidden`, never a
// `not_found` existence leak, and the ISSUE_INCLUDE join runs once per mutation.
async function simpleSet(args: {
  actorId: string; issue: Loaded; type: 'priority' | 'project' | 'due_date' | 'title'
  // Unchecked variant so scalar FK writes (e.g. projectId) are accepted; the
  // checked IssueUpdateInput exposes the `project` relation instead of the scalar.
  data: P.IssueUncheckedUpdateInput; from: unknown; to: unknown
}): Promise<IssueDto> {
  const issue = args.issue
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.issue.update({ where: { id: issue.id }, data: args.data, include: ISSUE_INCLUDE })
    await tx.issueActivity.create({ data: { issueId: issue.id, actorId: args.actorId, type: args.type, data: { from: args.from, to: args.to } as P.InputJsonValue } })
    return u
  })
  await emitEvent({ t: 'issue', id: issue.id, projectId: updated.projectId ?? undefined })
  return toDto(updated)
}

export async function setPriority(args: { actorId: string; role: Role; issueId: string; priority: IssuePriority }): Promise<IssueDto> {
  assertCanMutate(args.role)
  const issue = await loadOrThrow(args.issueId)
  return simpleSet({ actorId: args.actorId, issue, type: 'priority', data: { priority: args.priority }, from: issue.priority, to: args.priority })
}
export async function setProject(args: { actorId: string; role: Role; issueId: string; projectId: string | null }): Promise<IssueDto> {
  assertCanMutate(args.role)
  if (args.projectId != null) await assertProjectExists(args.projectId) // §3.2; only null detaches — '' is a bad id, not a detach
  const issue = await loadOrThrow(args.issueId)
  // F5: project-scoped labels that don't belong on the destination detach with
  // the move, one 'labels' activity recording it.
  const stale = splitLabelsForProject(issue.labels.map((l) => l.label), args.projectId).drop
  const updated = await prisma.$transaction(async (tx) => {
    await tx.issue.update({ where: { id: issue.id }, data: { projectId: args.projectId } })
    await tx.issueActivity.create({ data: { issueId: issue.id, actorId: args.actorId, type: 'project', data: { from: issue.projectId, to: args.projectId } as P.InputJsonValue } })
    if (stale.length) {
      await tx.issueLabel.deleteMany({ where: { issueId: issue.id, labelId: { in: stale.map((l) => l.id) } } })
      const after = (await tx.issueLabel.findMany({ where: { issueId: issue.id }, select: { labelId: true } })).map((l) => l.labelId)
      await tx.issueActivity.create({ data: { issueId: issue.id, actorId: args.actorId, type: 'labels', data: { from: issue.labels.map((l) => l.labelId), to: after } as P.InputJsonValue } })
    }
    // Fresh load AFTER the detach — `u` captured pre-deleteMany would still carry the stale labels.
    return tx.issue.findUniqueOrThrow({ where: { id: issue.id }, include: ISSUE_INCLUDE })
  })
  await emitEvent({ t: 'issue', id: issue.id, projectId: updated.projectId ?? undefined })
  return toDto(updated)
}
export async function setDueDate(args: { actorId: string; role: Role; issueId: string; dueDate: Date | null }): Promise<IssueDto> {
  assertCanMutate(args.role)
  const issue = await loadOrThrow(args.issueId)
  // Clearing/moving the due date re-arms BOTH one-shot pings (due-soon + overdue).
  return simpleSet({ actorId: args.actorId, issue, type: 'due_date', data: { dueDate: args.dueDate, dueSoonPingedAt: null, overduePingedAt: null }, from: issue.dueDate?.toISOString() ?? null, to: args.dueDate?.toISOString() ?? null })
}
export async function setTitle(args: { actorId: string; role: Role; issueId: string; title: string }): Promise<IssueDto> {
  assertCanMutate(args.role) // permission before validation, matching createIssue's ordering
  const title = args.title.trim()
  if (title.length < 1 || title.length > 200) throw new PolicyError('invalid', 'Title must be 1–200 characters.')
  const issue = await loadOrThrow(args.issueId)
  return simpleSet({ actorId: args.actorId, issue, type: 'title', data: { title }, from: issue.title, to: title })
}

// ── labels (replace set; one 'labels' activity) ───────────────────────────────
export async function setLabels(args: { actorId: string; role: Role; issueId: string; labelIds: string[] }): Promise<IssueDto> {
  assertCanMutate(args.role)
  const next = [...new Set(args.labelIds)]
  await assertLabelsExist(next) // §3.2, before the load — mirrors setAssignee/setProject
  const issue = await loadOrThrow(args.issueId)
  const before = issue.labels.map((l) => l.labelId)
  const updated = await prisma.$transaction(async (tx) => {
    await tx.issueLabel.deleteMany({ where: { issueId: issue.id } })
    await tx.issueLabel.createMany({ data: next.map((labelId) => ({ issueId: issue.id, labelId })) })
    await tx.issueActivity.create({ data: { issueId: issue.id, actorId: args.actorId, type: 'labels', data: { from: before, to: next } } })
    return tx.issue.findUniqueOrThrow({ where: { id: issue.id }, include: ISSUE_INCLUDE })
  })
  await emitEvent({ t: 'issue', id: issue.id, projectId: updated.projectId ?? undefined })
  return toDto(updated)
}

// ── description (no activity; notifies newly-mentioned users) ──────────────────
export async function updateDescription(args: { actorId: string; role: Role; issueId: string; description: string }): Promise<IssueDto> {
  assertCanMutate(args.role)
  const issue = await loadOrThrow(args.issueId)
  const description = args.description.slice(0, 20000)
  const updated = await prisma.issue.update({ where: { id: issue.id }, data: { description }, include: ISSUE_INCLUDE })
  await emitEvent({ t: 'issue', id: issue.id, projectId: updated.projectId ?? undefined })
  await notifyNewMentions({
    actorId: args.actorId, issueId: issue.id, identifier: formatIdentifier(issue.number), title: issue.title, where: 'the description',
    before: parseMentions(issue.description).userIds, after: parseMentions(description).userIds,
  })
  return toDto(updated)
}

// ── board move (status and/or rank; rebalance on precision exhaustion) ─────────
export async function moveIssue(args: {
  actorId: string; role: Role; issueId: string; status: IssueStatus
  prevId?: string | null; nextId?: string | null // neighbours in the destination column (prev above = smaller rank)
}): Promise<IssueDto> {
  assertCanMutate(args.role)
  const issue = await loadOrThrow(args.issueId)
  const [prev, next] = await Promise.all([
    args.prevId ? prisma.issue.findUnique({ where: { id: args.prevId }, select: { rank: true } }) : null,
    args.nextId ? prisma.issue.findUnique({ where: { id: args.nextId }, select: { rank: true } }) : null,
  ])
  let rank: string
  try {
    rank = rankBetween(prev?.rank ?? null, next?.rank ?? null)
  } catch {
    rank = await rebalanceAndPlace(args.status, issue.id, args.prevId ?? null, args.nextId ?? null)
  }
  if (rank.length > REBALANCE_THRESHOLD) {
    rank = await rebalanceAndPlace(args.status, issue.id, args.prevId ?? null, args.nextId ?? null)
  }
  const statusChanged = issue.status !== args.status
  const updated = await prisma.$transaction(async (tx) => {
    const completedAt = args.status === 'DONE' ? (issue.completedAt ?? new Date()) : issue.status === 'DONE' ? null : issue.completedAt
    const u = await tx.issue.update({ where: { id: issue.id }, data: { status: args.status, rank, completedAt }, include: ISSUE_INCLUDE })
    if (statusChanged) await tx.issueActivity.create({ data: { issueId: issue.id, actorId: args.actorId, type: 'status', data: { from: issue.status, to: args.status } } })
    return u
  })
  await emitEvent({ t: 'issue_move', id: issue.id, status: args.status, rank })
  if (statusChanged) await maybeNotifyDone(issue, issue.status, args.status, args.actorId)
  return toDto(updated)
}

// Reseat the destination column with evenly-spaced keys, placing the moved issue
// at its target slot; returns the moved issue's fresh rank. Rare, self-healing.
async function rebalanceAndPlace(status: IssueStatus, movedId: string, prevId: string | null, nextId: string | null): Promise<string> {
  const column = await prisma.issue.findMany({ where: { status }, orderBy: { rank: 'asc' }, select: { id: true } })
  const ordered = column.map((c) => c.id).filter((id) => id !== movedId)
  const prevIdx = prevId ? ordered.indexOf(prevId) : -1
  const insertAt = prevId ? prevIdx + 1 : nextId ? Math.max(0, ordered.indexOf(nextId)) : ordered.length
  ordered.splice(insertAt, 0, movedId)
  const keys = rebalance(ordered.length)
  await prisma.$transaction(ordered.map((id, i) => prisma.issue.update({ where: { id }, data: { rank: keys[i] } })))
  return keys[ordered.indexOf(movedId)]
}

// ── labels + attachments ──────────────────────────────────────────────────────
export type LabelDto = { id: string; name: string; color: string; projectId: string | null; project: { id: string; name: string } | null }

// P2002 = the two partial uniques (migration SQL; Prisma can't express them) →
// friendly invalid; P2025 = missing row → not_found. Everything else rethrows.
function labelWriteError(e: unknown, p20: string, p25: string): never {
  const code = (e as { code?: string }).code
  if (code === 'P2002') throw new PolicyError('invalid', p20)
  if (code === 'P2025') throw new PolicyError('not_found', p25)
  throw e
}

export async function createLabel(args: { actorId: string; role: Role; name: string; projectId?: string | null }): Promise<LabelDto> {
  assertCanMutate(args.role)
  const name = args.name.trim()
  if (name.length < 1 || name.length > 40) throw new PolicyError('invalid', 'Label name must be 1–40 characters.')
  const projectId = args.projectId ?? null
  if (projectId != null) await assertProjectExists(projectId)
  const scopeCount = await prisma.label.count({ where: { projectId } })
  try {
    return await prisma.label.create({
      data: { name, color: nextLabelColor(scopeCount), projectId },
      include: { project: { select: { id: true, name: true } } },
    })
  } catch (e) { labelWriteError(e, 'A label with that name already exists here.', 'Project not found.') }
}

export async function renameLabel(args: { actorId: string; role: Role; labelId: string; name: string }): Promise<LabelDto> {
  assertCanMutate(args.role)
  const name = args.name.trim()
  if (name.length < 1 || name.length > 40) throw new PolicyError('invalid', 'Label name must be 1–40 characters.')
  try {
    return await prisma.label.update({ where: { id: args.labelId }, data: { name }, include: { project: { select: { id: true, name: true } } } })
  } catch (e) { labelWriteError(e, 'A label with that name already exists here.', 'Label not found.') }
}

// Deleting detaches from every issue (IssueLabel cascade). No per-issue activity
// rows — a label delete would spam every affected timeline.
export async function deleteLabel(args: { actorId: string; role: Role; labelId: string }): Promise<void> {
  assertCanMutate(args.role)
  const existing = await prisma.label.findUnique({ where: { id: args.labelId }, select: { id: true } })
  if (!existing) throw new PolicyError('not_found', 'Label not found.')
  await prisma.label.delete({ where: { id: existing.id } })
}

export async function listLabels(): Promise<LabelDto[]> {
  return prisma.label.findMany({
    orderBy: [{ projectId: 'asc' }, { name: 'asc' }],
    include: { project: { select: { id: true, name: true } } },
  })
}

export async function attachIssueFiles(args: {
  actorId: string; role: Role; issueId: string; files: { path: string; name: string; mime: string; size: number }[]
}): Promise<IssueDto> {
  assertCanMutate(args.role)
  // Only server-generated issues uploads may be referenced (saveUpload emits
  // /uploads/issues/<uuid>.<ext>). Rejecting any other uploads-tree path closes a
  // cross-feature file-reference IDOR — e.g. attaching another user's chat upload
  // or avatar to an issue. The '..' check is belt-and-braces (paths are UUIDs).
  for (const f of args.files) {
    if (!f.path.startsWith('/uploads/issues/') || f.path.includes('..')) {
      throw new PolicyError('invalid', 'Attachments must be issue uploads.')
    }
  }
  const issue = await loadOrThrow(args.issueId)
  if (args.files.length) {
    await prisma.issueAttachment.createMany({
      data: args.files.map((f) => ({ issueId: issue.id, uploaderId: args.actorId, path: f.path, name: f.name.slice(0, 200), mime: f.mime, size: f.size })),
    })
    await emitEvent({ t: 'issue', id: issue.id, projectId: issue.projectId ?? undefined })
  }
  return toDto(await loadOrThrow(issue.id))
}

// ── delete (hard, cascading) ──────────────────────────────────────────────────
// Hard, cascading delete — the deleteDocument shape (document-service.ts:66-73).
// Creator-or-admin, guests barred; SILENT (no #lab-updates announce, matching
// deleteProject/deleteDocument); no new SSE event type.
export async function deleteIssue(args: { issueId: string; actorId: string; role: Role }): Promise<void> {
  // Load BEFORE the assert (deleteDocument:67-69): a forged or already-deleted id is
  // a 404, and only a real issue can ever produce a 403.
  const issue = await prisma.issue.findUnique({
    where: { id: args.issueId },
    select: { id: true, creatorId: true, projectId: true, attachments: { select: { path: true } } },
  })
  if (!issue) throw new PolicyError('not_found', 'Issue not found.')
  assertCanDeleteIssue(args.role, issue.creatorId, args.actorId)
  // One delete removes IssueLabel / IssueComment / IssueAttachment / IssueActivity —
  // all four cascade (schema.prisma:504, :514, :529, :543). No transaction needed.
  await prisma.issue.delete({ where: { id: issue.id } })
  // Best-effort unlink, per path. Unlike deleteDocument's single call this loops, so a
  // per-path guard keeps one EACCES from aborting the rest — the row is already gone.
  for (const a of issue.attachments) {
    try { await removeUpload(a.path) } catch (e) { console.error('deleteIssue: unlink failed', a.path, e) }
  }
  // The EXISTING { t: 'issue' } member (events.ts:17) — isIssueRefetchEvent already
  // returns true for it (issue-events.ts:11), so the list and board drop the row and
  // anyone holding the detail page open re-renders into notFound().
  await emitEvent({ t: 'issue', id: issue.id, projectId: issue.projectId ?? undefined })
}

// ── detail (issue + attachments; the merged timeline lives in comment-service) ─
export type IssueDetail = { issue: IssueDto; attachments: { id: string; path: string; name: string; mime: string; size: number }[] }
export async function getIssueDetail(id: string): Promise<IssueDetail | null> {
  const i = await prisma.issue.findUnique({ where: { id }, include: ISSUE_INCLUDE })
  if (!i) return null
  const attachments = await prisma.issueAttachment.findMany({ where: { issueId: id }, orderBy: { id: 'asc' }, select: { id: true, path: true, name: true, mime: true, size: true } })
  return { issue: toDto(i), attachments }
}
