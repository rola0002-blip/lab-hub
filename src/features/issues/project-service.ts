import 'server-only'
import type { ProjectStatus } from '@prisma/client'
import type { Role } from '@/lib/session'
import { prisma } from '@/lib/db'
import { assertCanMutate, canDeleteProject, PolicyError } from './issue-policy'

export type ProjectDto = {
  id: string; name: string; description: string
  lead: { id: string; name: string; image: string | null } | null
  startDate: string | null; targetDate: string | null; status: ProjectStatus
  progress: { done: number; total: number; percent: number }
  createdAt: string; updatedAt: string
}

const LEAD_SELECT = { select: { id: true, name: true, image: true } } as const

type LoadedProject = {
  id: string; name: string; description: string
  lead: { id: string; name: string; image: string | null } | null
  startDate: Date | null; targetDate: Date | null; status: ProjectStatus; createdAt: Date; updatedAt: Date
}

function toDto(p: LoadedProject, done: number, total: number): ProjectDto {
  return {
    id: p.id, name: p.name, description: p.description,
    lead: p.lead ? { id: p.lead.id, name: p.lead.name, image: p.lead.image } : null,
    startDate: p.startDate?.toISOString() ?? null, targetDate: p.targetDate?.toISOString() ?? null, status: p.status,
    progress: { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) },
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  }
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

export async function listProjects(): Promise<ProjectDto[]> {
  const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' }, include: { lead: LEAD_SELECT } })
  // Two grouped counts instead of N per-project queries. CANCELED issues are
  // excluded from the denominator (same Linear semantics as progressFor).
  const totals = await prisma.issue.groupBy({ by: ['projectId'], _count: { _all: true }, where: { projectId: { not: null }, status: { not: 'CANCELED' } } })
  const dones = await prisma.issue.groupBy({ by: ['projectId'], _count: { _all: true }, where: { projectId: { not: null }, status: 'DONE' } })
  const totalBy = new Map(totals.map((t) => [t.projectId, t._count._all]))
  const doneBy = new Map(dones.map((d) => [d.projectId, d._count._all]))
  return projects.map((p) => toDto(p, doneBy.get(p.id) ?? 0, totalBy.get(p.id) ?? 0))
}

export async function getProject(id: string): Promise<ProjectDto | null> {
  const p = await prisma.project.findUnique({ where: { id }, include: { lead: LEAD_SELECT } })
  if (!p) return null
  const { done, total } = await progressFor(id)
  return toDto(p, done, total)
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

export async function createProject(args: {
  actorId: string; role: Role; name: string; description?: string
  leadId?: string | null; startDate?: Date | null; targetDate?: Date | null; status?: ProjectStatus
}): Promise<ProjectDto> {
  assertCanMutate(args.role)
  const name = validateName(args.name)
  validateDateOrder(args.startDate ?? null, args.targetDate ?? null)
  const p = await prisma.project.create({
    data: {
      name, description: (args.description ?? '').slice(0, 4000),
      leadId: args.leadId ?? null, startDate: args.startDate ?? null, targetDate: args.targetDate ?? null, status: args.status ?? 'ACTIVE',
    },
    include: { lead: LEAD_SELECT },
  })
  return toDto(p, 0, 0)
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
    include: { lead: LEAD_SELECT },
  })
  const { done, total } = await progressFor(args.id)
  return toDto(p, done, total)
}

// Admin-only. Cascades issues to projectId = null (the Issue.projectId FK is
// onDelete: SetNull), never deleting the issues themselves.
export async function deleteProject(args: { role: Role; id: string }): Promise<void> {
  if (!canDeleteProject(args.role)) throw new PolicyError('forbidden', 'Only admins can delete a project.')
  const existing = await prisma.project.findUnique({ where: { id: args.id } })
  if (!existing) throw new PolicyError('not_found', 'Project not found.')
  await prisma.project.delete({ where: { id: args.id } }) // FK SetNull detaches issues
}
