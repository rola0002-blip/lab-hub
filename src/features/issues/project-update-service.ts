import 'server-only'
import type { Prisma, ProjectHealth } from '@prisma/client'
import type { Role } from '@/lib/session'
import { prisma } from '@/lib/db'
import * as bot from '@/features/bot'
import { isMember } from '@/features/chat/conversation-service'
import { assertCanMutate, canDeleteProjectUpdate, canEditProjectUpdate, PolicyError } from './issue-policy'
import { assertProjectExists } from './issue-service'
import { nthPromptAfter } from './update-prompt'
import { PROJECT_HEALTH_LABEL } from './project-health'

export type ProjectUpdateDto = {
  id: string; projectId: string; health: ProjectHealth; body: string
  author: { id: string; name: string; image: string | null }
  originMessageId: string | null; createdAt: string
  // v0.15 §6: a retracted update stays in the feed as an empty tombstone (the
  // CommentDto shape), and a corrected one says when it was corrected.
  deleted: boolean; editedAt: string | null
}

const AUTHOR_SELECT = { select: { id: true, name: true, image: true } } as const
const BODY_MAX = 4000       // sendMessage truncates at 4000 — never exceed it (spec §4.0)
const EXCERPT_MAX = 200     // the announce line can never be silently truncated mid-thought
const FEED_MAX = 50         // the detail-page feed is bounded; a project's history is not

// THE reverse-chron ordering for ProjectUpdate rows. `createdAt` alone is not a
// total order — two updates posted in the same millisecond tie, and Postgres is
// then free to return them in either order — so the newest-first feed and the two
// "latest update" picks (project-service's getProject and listProjects) could each
// name a different row as latest. The id tiebreaker makes the order total, and all
// three sites import THIS tuple so they can never drift apart.
//
// v0.15 §6.2 — FOUR sites now answer "what is the latest update", and they split:
//   1. listProjectUpdates (below)            — the feed, deliberately UNFILTERED
//   2. project-service listProjects          — groupBy(_max createdAt) + its follow-up findMany
//   3. project-service getProject            — findFirst
//   4. jobs.ts promptProjectUpdates          — the digest window read
// Sites 2–4 all carry `deletedAt: null`; the feed does NOT, because a tombstone is
// still part of the project's history. Site 4 filters by hand and orders by
// createdAt alone (it reads only that column, so it needs no tiebreak).
export const PROJECT_UPDATE_ORDER: Prisma.ProjectUpdateOrderByWithRelationInput[] = [
  { createdAt: 'desc' }, { id: 'desc' },
]

function toDto(u: {
  id: string; projectId: string; health: ProjectHealth; body: string; originMessageId: string | null
  editedAt: Date | null; deletedAt: Date | null; createdAt: Date
  author: { id: string; name: string; image: string | null }
}): ProjectUpdateDto {
  return {
    id: u.id, projectId: u.projectId, health: u.health,
    // deleteProjectUpdate already blanks the column; this is CommentDto's toDto
    // belt-and-braces, so a tombstone written by any other path (a fixture, a
    // manual SQL retraction) can never leak the retracted text to a client.
    body: u.deletedAt ? '' : u.body,
    author: { id: u.author.id, name: u.author.name, image: u.author.image },
    originMessageId: u.originMessageId, createdAt: u.createdAt.toISOString(),
    deleted: !!u.deletedAt, editedAt: u.editedAt?.toISOString() ?? null,
  }
}

export async function postProjectUpdate(args: {
  projectId: string; actorId: string; role: Role; health: ProjectHealth; body: string; originMessageId?: string | null
}): Promise<ProjectUpdateDto> {
  assertCanMutate(args.role)                       // guests read-only (§3.3 — one predicate)
  await assertProjectExists(args.projectId)
  const body = args.body.trim().slice(0, BODY_MAX)
  if (!body) throw new PolicyError('invalid', 'An update needs a few words.')
  // Origin backlink (post-from-message): identical forged-id guard to createIssue —
  // a missing message and a non-member raise the SAME not_found (no existence leak).
  if (args.originMessageId) {
    const msg = await prisma.message.findUnique({ where: { id: args.originMessageId }, select: { conversationId: true } })
    if (!msg || !(await isMember(args.actorId, msg.conversationId))) throw new PolicyError('not_found', 'Message not found.')
  }
  const project = await prisma.project.findUniqueOrThrow({ where: { id: args.projectId }, select: { name: true } })
  const created = await prisma.projectUpdate.create({
    data: { projectId: args.projectId, authorId: args.actorId, health: args.health, body, originMessageId: args.originMessageId ?? null },
    include: { author: AUTHOR_SELECT },
  })
  // AWAITED, not void: the void announce sites are what forced resetDb's deadlock-retry
  // loop; the action is weekly and announceToChannel is internally non-fatal (§4.6).
  const excerpt = body.length > EXCERPT_MAX ? `${body.slice(0, EXCERPT_MAX)}…` : body
  await bot.announceToChannel(
    `${created.author.name} posted an update on ${project.name} — ${PROJECT_HEALTH_LABEL[args.health]}: ${excerpt} — /projects/${args.projectId}`,
    args.actorId,
  )
  return toDto(created)
}

// Newest FEED_MAX updates. The page renders every row it gets (no pagination), so
// an unbounded read would grow the payload with the project's whole history; the
// cap keeps it flat and always includes the latest.
//
// NOT filtered on deletedAt (v0.15 §6.2), unlike every "latest" pick: a retraction
// is part of the record, so the feed returns the tombstone (deleted:true, body '')
// and the UI renders "Update removed" in place. Filtering here would make a delete
// look like the update was never written.
export async function listProjectUpdates(projectId: string): Promise<ProjectUpdateDto[]> {
  const rows = await prisma.projectUpdate.findMany({
    where: { projectId }, orderBy: PROJECT_UPDATE_ORDER, take: FEED_MAX, include: { author: AUTHOR_SELECT },
  })
  return rows.map(toDto)
}

// ONE load path for both mutations. Missing and already-tombstoned are the SAME
// not_found: to every writer a retracted update is gone (the editComment contract).
async function loadLiveUpdate(id: string) {
  const u = await prisma.projectUpdate.findUnique({ where: { id }, include: { author: AUTHOR_SELECT } })
  if (!u || u.deletedAt) throw new PolicyError('not_found', 'Update not found.')
  return u
}

// v0.15 §6.2. Assert-then-load (the comment-service contract): the blanket role
// gate runs before any DB read, so a guest gets `forbidden` even for a missing row
// — no existence leak — and ownership then narrows it.
//
// Silent by design, like the retraction below: NO #lab-updates announce (the
// original line records what was said at the time and a correction does not
// re-announce), NO bell, and NO latch write — `lastUpdatePromptAt` belongs to the
// prompt job, and "updated N days ago" derives from max(createdAt), which an edit
// deliberately does not move.
export async function editProjectUpdate(args: {
  updateId: string; actorId: string; role: Role; body: string; health: ProjectHealth
}): Promise<ProjectUpdateDto> {
  assertCanMutate(args.role)
  const u = await loadLiveUpdate(args.updateId)
  if (!canEditProjectUpdate(args.role, u.authorId, args.actorId)) {
    throw new PolicyError('forbidden', 'You can only edit your own updates.')
  }
  const body = args.body.trim().slice(0, BODY_MAX)   // same trim+cap as postProjectUpdate
  if (!body) throw new PolicyError('invalid', 'An update needs a few words.')
  const updated = await prisma.projectUpdate.update({
    where: { id: u.id }, data: { body, health: args.health, editedAt: new Date() },
    include: { author: AUTHOR_SELECT },
  })
  return toDto(updated)
}

// Soft, never hard (the deleteMessage/deleteComment tombstone posture): the row
// survives with an empty body so the feed keeps the gap visible, and `health` is
// retained on the row but never rendered again — this is a retraction, not a shred.
// The four latest-update reads skip it from here on.
export async function deleteProjectUpdate(args: { updateId: string; actorId: string; role: Role }): Promise<void> {
  assertCanMutate(args.role)
  const u = await loadLiveUpdate(args.updateId)
  if (!canDeleteProjectUpdate(args.role, u.authorId, args.actorId)) {
    throw new PolicyError('forbidden', 'You can only delete your own updates.')
  }
  await prisma.projectUpdate.update({ where: { id: u.id }, data: { deletedAt: new Date(), body: '' } })
}

async function loadProjectOrThrow(id: string): Promise<void> {
  const p = await prisma.project.findUnique({ where: { id }, select: { id: true } })
  if (!p) throw new PolicyError('not_found', 'Project not found.')
}

// Snooze: anchored to the nth prompt instant AFTER now, +1ms so the job's
// `pausedUntil <= now` test resolves deterministically AT the prompt hour (§4.6).
export async function pauseUpdatePrompts(args: { projectId: string; actorId: string; role: Role; weeks: number }): Promise<void> {
  assertCanMutate(args.role)
  await loadProjectOrThrow(args.projectId)
  const org = await prisma.organization.findFirst({ select: { timezone: true, updatePromptDay: true, updatePromptHour: true } })
  const tz = org?.timezone ?? 'Asia/Singapore'
  const until = new Date(+nthPromptAfter(new Date(), args.weeks, tz, org?.updatePromptDay ?? 2, org?.updatePromptHour ?? 16) + 1)
  await prisma.project.update({ where: { id: args.projectId }, data: { updatePromptsPausedUntil: until } })
}

export async function resumeUpdatePrompts(args: { projectId: string; actorId: string; role: Role }): Promise<void> {
  assertCanMutate(args.role)
  await loadProjectOrThrow(args.projectId)
  await prisma.project.update({ where: { id: args.projectId }, data: { updatePromptsPausedUntil: null } })
}
