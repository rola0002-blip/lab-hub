import 'server-only'
import type { ProjectHealth, ProjectStatus } from '@prisma/client'
import type { Role } from '@/lib/session'
import { prisma } from '@/lib/db'
import * as bot from '@/features/bot'
import { assertCanMutate, canDeleteProject, PolicyError } from './issue-policy'
import { rankBetween, rebalance, REBALANCE_THRESHOLD } from './rank'
import { assertAssigneeExists } from './issue-service'
import { isEffectiveLead } from './project-health'
import { PROJECT_UPDATE_ORDER } from './project-update-service'
import { startOfOrgDay } from './due'
import { OPEN_STATUSES } from './status'

export type ProjectDto = {
  id: string; name: string; description: string
  lead: { id: string; name: string; image: string | null } | null
  // SP8 §4.7 review-screen inputs. REQUIRED on the whole DTO surface — listProjects
  // and getProject fill all three, so healthBucket/compareProjectsWorstFirst can be
  // fed straight from a card or a detail page with no second read.
  hasEffectiveLead: boolean                     // lead exists AND banned:false, isSystem:false, role!=='guest' (§4.4)
  latestUpdate: { id: string; health: ProjectHealth; createdAt: string; authorName: string } | null
  openOverdue: number
  startDate: string | null; targetDate: string | null; status: ProjectStatus
  progress: { done: number; total: number; percent: number }
  // v0.12: the grid's manual arrangement key (lowest = front). Every DTO producer
  // fills it, so a card can be reordered straight from a list or a detail read.
  rank: string
  createdAt: string; updatedAt: string
}

// Widened for isEffectiveLead (banned/isSystem/role). Those three stay INTERNAL —
// the DTO's `lead` still exposes only { id, name, image }, so no membership-ish
// user state leaks into a client component.
const LEAD_SELECT = { select: { id: true, name: true, image: true, banned: true, isSystem: true, role: true } } as const

type LoadedProject = {
  id: string; name: string; description: string
  lead: { id: string; name: string; image: string | null; banned: boolean; isSystem: boolean; role: string } | null
  startDate: Date | null; targetDate: Date | null; status: ProjectStatus; rank: string; createdAt: Date; updatedAt: Date
}

type Extras = { latestUpdate: ProjectDto['latestUpdate']; openOverdue: number }

function toDto(p: LoadedProject, done: number, total: number, extras: Extras): ProjectDto {
  return {
    id: p.id, name: p.name, description: p.description,
    lead: p.lead ? { id: p.lead.id, name: p.lead.name, image: p.lead.image } : null,
    hasEffectiveLead: isEffectiveLead(p.lead),
    latestUpdate: extras.latestUpdate, openOverdue: extras.openOverdue,
    startDate: p.startDate?.toISOString() ?? null, targetDate: p.targetDate?.toISOString() ?? null, status: p.status,
    progress: { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) },
    rank: p.rank,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  }
}

// The newest ProjectUpdate row → the DTO's latestUpdate shape. Shared by both read
// paths so the list card and the detail page can never disagree on the field.
type LatestUpdateRow = { id: string; health: ProjectHealth; createdAt: Date; author: { name: string } }
function toLatestUpdate(r: LatestUpdateRow | null | undefined): ProjectDto['latestUpdate'] {
  return r ? { id: r.id, health: r.health, createdAt: r.createdAt.toISOString(), authorName: r.author.name } : null
}

// Org timezone for the overdue day boundary (same default as every other org read).
async function orgTimezone(): Promise<string> {
  const org = await prisma.organization.findFirst({ select: { timezone: true } })
  return org?.timezone ?? 'Asia/Singapore'
}

// Linear semantics (adjudicated 2026-07-12): CANCELED issues are excluded from
// the denominator — progress = count(DONE) ÷ count(status ≠ CANCELED).
async function progressFor(projectId: string): Promise<{ done: number; total: number }> {
  const [total, done] = await Promise.all([
    prisma.issue.count({ where: { projectId, status: { not: 'CANCELED' } } }),
    prisma.issue.count({ where: { projectId, status: 'DONE' } }),
  ])
  return { done, total }
}

// `now` is injectable purely for the overdue day boundary (tests pin it); every
// call site in the app uses the default. Seven queries total, O(1) in the number of
// projects — grouped aggregates, never a per-project read.
export async function listProjects(now: Date = new Date()): Promise<ProjectDto[]> {
  const tz = await orgTimezone()
  const [projects, totals, dones, overdues, latests] = await Promise.all([
    prisma.project.findMany({ orderBy: { rank: 'asc' }, include: { lead: LEAD_SELECT } }),
    // Two grouped counts instead of N per-project queries. CANCELED issues are
    // excluded from the denominator (same Linear semantics as progressFor).
    prisma.issue.groupBy({ by: ['projectId'], _count: { _all: true }, where: { projectId: { not: null }, status: { not: 'CANCELED' } } }),
    prisma.issue.groupBy({ by: ['projectId'], _count: { _all: true }, where: { projectId: { not: null }, status: 'DONE' } }),
    // Open + past-due, day-granular in the org zone — the same boundary the overdue
    // chip and the overdue nudge use (due.ts), so the counts always agree.
    prisma.issue.groupBy({
      by: ['projectId'], _count: { _all: true },
      where: { projectId: { not: null }, status: { in: OPEN_STATUSES }, dueDate: { lt: startOfOrgDay(now, tz) } },
    }),
    prisma.projectUpdate.groupBy({ by: ['projectId'], _max: { createdAt: true } }),
  ])
  // The newest update per project in ONE follow-up read: group for the max instant,
  // then fetch exactly those (projectId, createdAt) rows for the author name. A
  // same-millisecond tie returns MORE than one row for a project, so the read is
  // ordered by the shared tuple and the first row per project wins below — the same
  // row getProject and listProjectUpdates call latest.
  const latestRows = latests.length
    ? await prisma.projectUpdate.findMany({
        where: { OR: latests.map((l) => ({ projectId: l.projectId, createdAt: l._max.createdAt! })) },
        orderBy: PROJECT_UPDATE_ORDER,
        include: { author: { select: { name: true } } },
      })
    : []
  const totalBy = new Map(totals.map((t) => [t.projectId, t._count._all]))
  const doneBy = new Map(dones.map((d) => [d.projectId, d._count._all]))
  const overdueBy = new Map(overdues.map((o) => [o.projectId, o._count._all]))
  const latestBy = new Map<string, ProjectDto['latestUpdate']>()
  for (const r of latestRows) if (!latestBy.has(r.projectId)) latestBy.set(r.projectId, toLatestUpdate(r))
  return projects.map((p) => toDto(p, doneBy.get(p.id) ?? 0, totalBy.get(p.id) ?? 0, {
    latestUpdate: latestBy.get(p.id) ?? null, openOverdue: overdueBy.get(p.id) ?? 0,
  }))
}

// The same three reads as listProjects, scoped to one id — one DTO shape, one
// definition of each field, whichever page you land on.
export async function getProject(id: string, now: Date = new Date()): Promise<ProjectDto | null> {
  const p = await prisma.project.findUnique({ where: { id }, include: { lead: LEAD_SELECT } })
  if (!p) return null
  const tz = await orgTimezone()
  const [progress, openOverdue, latest] = await Promise.all([
    progressFor(id),
    prisma.issue.count({ where: { projectId: id, status: { in: OPEN_STATUSES }, dueDate: { lt: startOfOrgDay(now, tz) } } }),
    prisma.projectUpdate.findFirst({ where: { projectId: id }, orderBy: PROJECT_UPDATE_ORDER, include: { author: { select: { name: true } } } }),
  ])
  return toDto(p, progress.done, progress.total, { latestUpdate: toLatestUpdate(latest), openOverdue })
}

// Narrow companion (§4.7): the issue pages and the global composer need only
// { id, name } — one option-list source, no review-screen joins. Same arrangement
// order as listProjects, so a dropdown never contradicts the grid.
export async function listProjectOptions(): Promise<{ id: string; name: string }[]> {
  return prisma.project.findMany({ orderBy: { rank: 'asc' }, select: { id: true, name: true } })
}

function validateName(name: string): string {
  const n = name.trim()
  if (n.length < 1 || n.length > 120) throw new PolicyError('invalid', 'Project name must be 1–120 characters.')
  return n
}

// A project's start date can never fall after its target date. Enforced here (the
// single service choke point) rather than by a DB constraint, so nulls on either
// side stay valid and the check applies uniformly to create and to update's merged
// (existing + incoming) values. Throws a 400-mapped PolicyError('invalid').
function validateDateOrder(startDate: Date | null, targetDate: Date | null): void {
  if (startDate && targetDate && startDate.getTime() > targetDate.getTime()) {
    throw new PolicyError('invalid', 'Start date must be on or before the target date.')
  }
}

// SP8 §3.2: same predicate as the assignee assert (guests legal; banned/system/missing
// rejected) — storing a guest lead stays allowed; §4.4's effective-lead predicate is
// where the guest narrowing lives (who gets PROMPTED, not who may be stored).
async function assertLeadExists(id: string): Promise<void> {
  return assertAssigneeExists(id)
}

export async function createProject(args: {
  actorId: string; role: Role; name: string; description?: string
  leadId?: string | null; startDate?: Date | null; targetDate?: Date | null; status?: ProjectStatus
}): Promise<ProjectDto> {
  assertCanMutate(args.role)
  const name = validateName(args.name)
  validateDateOrder(args.startDate ?? null, args.targetDate ?? null)
  if (args.leadId != null) await assertLeadExists(args.leadId) // '' is falsy but IS stored — guard on null, not truthiness
  // A new project lands at the FRONT of the arrangement (an empty table yields a
  // null bound, which rankBetween reads as "no neighbour" on that side).
  const front = await prisma.project.findFirst({ orderBy: { rank: 'asc' }, select: { rank: true } })
  const p = await prisma.project.create({
    data: {
      name, description: (args.description ?? '').slice(0, 4000),
      leadId: args.leadId ?? null, startDate: args.startDate ?? null, targetDate: args.targetDate ?? null, status: args.status ?? 'ACTIVE',
      rank: rankBetween(null, front?.rank ?? null),
    },
    include: { lead: LEAD_SELECT },
  })
  void bot.announceToChannel(`New project: ${p.name} — /projects/${p.id}`, args.actorId)
  // A just-created project provably has no issues and no updates, so the extras are
  // exact without a re-read (getProject would only re-derive these same zeros).
  return toDto(p, 0, 0, { latestUpdate: null, openOverdue: 0 })
}

export async function updateProject(args: {
  actorId: string; role: Role; id: string; name?: string; description?: string
  leadId?: string | null; startDate?: Date | null; targetDate?: Date | null; status?: ProjectStatus
}): Promise<ProjectDto> {
  assertCanMutate(args.role)
  const existing = await prisma.project.findUnique({ where: { id: args.id } })
  if (!existing) throw new PolicyError('not_found', 'Project not found.')
  // Validate the ordering against the values that WILL be stored: an incoming field
  // wins, otherwise the existing one holds (so updating only one date still can't
  // invert the pair).
  validateDateOrder(
    args.startDate !== undefined ? args.startDate : existing.startDate,
    args.targetDate !== undefined ? args.targetDate : existing.targetDate,
  )
  // `!= null` skips undefined (untouched) and null (clear) only; the update spread is
  // keyed on `!== undefined`, so a falsy-but-present '' would otherwise be written.
  if (args.leadId != null) await assertLeadExists(args.leadId)
  // No lead include here: the DTO is re-read through getProject below (it fills the
  // §4.7 extras), so this write only needs the fields the announce reads.
  const p = await prisma.project.update({
    where: { id: args.id },
    data: {
      ...(args.name !== undefined ? { name: validateName(args.name) } : {}),
      ...(args.description !== undefined ? { description: args.description.slice(0, 4000) } : {}),
      ...(args.leadId !== undefined ? { leadId: args.leadId } : {}),
      ...(args.startDate !== undefined ? { startDate: args.startDate } : {}),
      ...(args.targetDate !== undefined ? { targetDate: args.targetDate } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    },
  })
  // Announce lead / startDate / targetDate changes (not name/description/status).
  const changes: string[] = []
  if (args.leadId !== undefined && args.leadId !== existing.leadId) {
    const lead = args.leadId ? await prisma.user.findUnique({ where: { id: args.leadId }, select: { name: true } }) : null
    changes.push(args.leadId ? `lead set to ${lead?.name ?? 'someone'}` : 'lead cleared')
  }
  if (args.startDate !== undefined && args.startDate?.getTime() !== existing.startDate?.getTime()) {
    changes.push(args.startDate ? `start date updated` : 'start date cleared')
  }
  if (args.targetDate !== undefined && args.targetDate?.getTime() !== existing.targetDate?.getTime()) {
    changes.push(args.targetDate ? `target date updated` : 'target date cleared')
  }
  if (changes.length) void bot.announceToChannel(`Project ${p.name}: ${changes.join(', ')} — /projects/${p.id}`, args.actorId)
  // One read path for the full DTO — the update's own row can't carry the §4.7
  // extras (progress, latest update, overdue count), and a second definition of
  // them here is exactly how the card and the detail page would drift apart.
  // Null only if a concurrent admin delete slipped between the write and this read
  // — a genuine 404 for the caller, never a null masquerading as a DTO.
  const dto = await getProject(args.id)
  if (!dto) throw new PolicyError('not_found', 'Project not found.')
  return dto
}

// ── arrangement move (v0.12 §6.1) ─────────────────────────────────────────────
// The client sends only the neighbours the project sits between AFTER the move;
// the server mints the key. The moveIssue shape minus status/activity/SSE — and
// deliberately silent: rearranging the shelf is not lab news, so no announce.
// `actorId` is carried for signature symmetry with every other mutation (nothing
// records an actor for a move).
export async function moveProject(args: {
  actorId: string; role: Role; projectId: string
  prevId: string | null; nextId: string | null
}): Promise<ProjectDto> {
  assertCanMutate(args.role)
  const existing = await prisma.project.findUnique({ where: { id: args.projectId }, select: { id: true } })
  if (!existing) throw new PolicyError('not_found', 'Project not found.')
  // A neighbour id that no longer resolves degrades to null = boundary, exactly
  // like the board: a stale client places its card, it does not error.
  const [prev, next] = await Promise.all([
    args.prevId ? prisma.project.findUnique({ where: { id: args.prevId }, select: { rank: true } }) : null,
    args.nextId ? prisma.project.findUnique({ where: { id: args.nextId }, select: { rank: true } }) : null,
  ])
  let rank: string
  try {
    rank = rankBetween(prev?.rank ?? null, next?.rank ?? null)
  } catch {
    rank = await rebalanceProjectsAndPlace(args.projectId, args.prevId, args.nextId)
  }
  if (rank.length > REBALANCE_THRESHOLD) {
    rank = await rebalanceProjectsAndPlace(args.projectId, args.prevId, args.nextId)
  }
  await prisma.project.update({ where: { id: args.projectId }, data: { rank } })
  // One read path for the full DTO (the §4.7 extras), as updateProject does.
  // Null only if a concurrent admin delete slipped in — a genuine 404.
  const dto = await getProject(args.projectId)
  if (!dto) throw new PolicyError('not_found', 'Project not found.')
  return dto
}

// Reseat the WHOLE table with evenly-spaced keys, placing the moved project at
// its target slot; returns its fresh key. Rare, self-healing. Whole-table scope
// is the deliberate analogue of the board's per-column scope — one arrangement
// sequence across all statuses, tens of rows. With inverted bounds "between the
// two" does not exist, so prevId wins; when neither bound resolves the project
// lands at the FRONT (the grid's entry point, §5.3, where the board appends).
async function rebalanceProjectsAndPlace(movedId: string, prevId: string | null, nextId: string | null): Promise<string> {
  const all = await prisma.project.findMany({ orderBy: { rank: 'asc' }, select: { id: true } })
  const ordered = all.map((p) => p.id).filter((id) => id !== movedId)
  const prevIdx = prevId ? ordered.indexOf(prevId) : -1
  const insertAt = prevId ? prevIdx + 1 : nextId ? Math.max(0, ordered.indexOf(nextId)) : 0
  ordered.splice(insertAt, 0, movedId)
  const keys = rebalance(ordered.length)
  await prisma.$transaction(ordered.map((id, i) => prisma.project.update({ where: { id }, data: { rank: keys[i] } })))
  return keys[ordered.indexOf(movedId)]
}

// Admin-only. Cascades issues to projectId = null (the Issue.projectId FK is
// onDelete: SetNull), never deleting the issues themselves.
export async function deleteProject(args: { role: Role; id: string }): Promise<void> {
  if (!canDeleteProject(args.role)) throw new PolicyError('forbidden', 'Only admins can delete a project.')
  const existing = await prisma.project.findUnique({ where: { id: args.id } })
  if (!existing) throw new PolicyError('not_found', 'Project not found.')
  await prisma.project.delete({ where: { id: args.id } }) // FK SetNull detaches issues
}
