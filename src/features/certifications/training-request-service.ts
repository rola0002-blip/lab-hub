import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { notify } from '@/lib/notify'
import * as bot from '@/features/bot'
import { isCertified, grantCertification } from './service'
import { orgToday } from '@/features/issues/due'
import { PolicyError } from './policy'

// v0.32 Task 6: certification training requests. An uncertified member asks the
// managers of an instrument for training; W21-A: ONLY the instrument's active
// managers decide — admins decide only when it has no active manager (the
// fallback that keeps a request from being stranded). Every entry point returns
// { ok, message? } — the create/decide UI renders the message verbatim. Guests
// cannot ask; certified members have nothing to ask.

export type RequestRow = {
  id: string; userId: string; userName: string; equipmentId: string; equipmentName: string
  note: string | null; createdAt: Date
}

// W21-A: an "active" manager can actually act — not banned, not the bot, not a
// guest (guests cannot reach /certifications; the page redirects them). A banned
// or guest manager row therefore never strands a request: the instrument counts
// as unmanaged and falls back to the admins. ONE definition, used by the fan-out,
// the queue, the count and the decide gate, so the four can never disagree.
// isManagerOf (admins manage everything) deliberately stays the booking /
// maintenance / export / Matrix gate — this rule is training-request-only.
const ACTIVE_MANAGER = {
  user: { banned: false, isSystem: false, role: { not: 'guest' } },
} satisfies Prisma.EquipmentManagerWhereInput

// The requests this viewer may decide: their own active-manager instruments, and
// — for an admin only — every instrument with no active manager.
function decidableWhere(user: { id: string; role: string }): Prisma.TrainingRequestWhereInput {
  const managed: Prisma.TrainingRequestWhereInput = { equipment: { managers: { some: { userId: user.id, ...ACTIVE_MANAGER } } } }
  if (user.role !== 'admin') return managed
  return { OR: [managed, { equipment: { managers: { none: ACTIVE_MANAGER } } }] }
}

export async function canDecideTrainingRequest(userId: string, equipmentId: string): Promise<boolean> {
  const [user, managerRow, activeManagers] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, banned: true, isSystem: true } }),
    prisma.equipmentManager.findUnique({ where: { userId_equipmentId: { userId, equipmentId } } }),
    prisma.equipmentManager.count({ where: { equipmentId, ...ACTIVE_MANAGER } }),
  ])
  if (!user || user.banned || user.isSystem || user.role === 'guest') return false
  if (managerRow) return true
  return user.role === 'admin' && activeManagers === 0
}

export async function createTrainingRequest(args: { userId: string; equipmentId: string; note?: string }): Promise<{ ok: boolean; message?: string }> {
  const [user, eq] = await Promise.all([
    prisma.user.findUnique({ where: { id: args.userId } }),
    prisma.equipment.findUnique({ where: { id: args.equipmentId } }),
  ])
  if (!user || user.role === 'guest' || user.banned) return { ok: false, message: 'Members can request training.' }
  if (!eq || !eq.certificationRequired) return { ok: false, message: 'This instrument does not require certification.' }
  if (await isCertified(args.userId, args.equipmentId)) return { ok: false, message: 'You are already certified on this instrument.' }
  const existing = await prisma.trainingRequest.findFirst({ where: { userId: args.userId, equipmentId: args.equipmentId, status: 'PENDING' } })
  if (existing) return { ok: false, message: 'You already have an open training request for this instrument.' }
  await prisma.trainingRequest.create({ data: { userId: args.userId, equipmentId: args.equipmentId, note: args.note?.slice(0, 500) } })
  // Notify the deciders (bell row + suppressed bot DM, one lane per person):
  // the instrument's active managers, or every admin when it has none (W21-A —
  // the same set decidableWhere scopes the queue and the badge to). The
  // requester is excluded even when they are a decider — since W20-C a bell row
  // pops out and pushes, so a self-alert is noise; they still see the request in
  // the Requests queue and its count.
  const managers = await prisma.equipmentManager.findMany({ where: { equipmentId: args.equipmentId, ...ACTIVE_MANAGER }, select: { userId: true } })
  const deciders = managers.length > 0
    ? managers.map((m) => m.userId)
    : (await prisma.user.findMany({ where: { role: 'admin', banned: false, isSystem: false }, select: { id: true } })).map((a) => a.id)
  const targets = [...new Set(deciders)].filter((id) => id !== args.userId)
  await Promise.all(targets.map((id) =>
    notify(id, 'training_request', { message: `${user.name} requested training on ${eq.name}${args.note ? ` — "${args.note.slice(0, 120)}"` : ''}` })))
  await Promise.all(targets.map((id) =>
    bot.dmUser(id, `${user.name} requested training on ${eq.name}. Review it under Certifications → Requests.`, { suppress: true })))
  return { ok: true }
}

export async function listPendingRequests(forUserId: string): Promise<RequestRow[]> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: forUserId } })
  const rows = await prisma.trainingRequest.findMany({
    where: { status: 'PENDING', ...decidableWhere(user) },
    include: { user: { select: { name: true } }, equipment: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((r) => ({ id: r.id, userId: r.userId, userName: r.user.name, equipmentId: r.equipmentId, equipmentName: r.equipment.name, note: r.note, createdAt: r.createdAt }))
}

// W20-D: the Requests queue's size for this viewer — scoped exactly like
// listPendingRequests (W21-A: decidableWhere — a manager's active-manager
// instruments; an admin additionally every instrument with no active manager).
export async function countPendingRequests(user: { id: string; role: string }): Promise<number> {
  if (user.role === 'guest') return 0
  return prisma.trainingRequest.count({ where: { status: 'PENDING', ...decidableWhere(user) } })
}

export async function decideTrainingRequest(args: { requestId: string; byId: string; decision: 'grant' | 'decline'; reason?: string; trainedOn?: string }): Promise<{ ok: boolean; message?: string }> {
  const req = await prisma.trainingRequest.findUnique({ where: { id: args.requestId }, include: { equipment: { select: { name: true } }, user: { select: { name: true } } } })
  if (!req || req.status !== 'PENDING') return { ok: false, message: 'This request is no longer pending.' }
  if (!(await canDecideTrainingRequest(args.byId, req.equipmentId))) return { ok: false, message: "Only this instrument's managers can decide this request." }
  if (args.decision === 'decline' && !args.reason?.trim()) return { ok: false, message: 'A reason is required to decline.' }
  if (args.decision === 'grant') {
    try {
      // org-tz today (NOT UTC): grantCertification compares against orgToday, and
      // for an org west of UTC a UTC date can be "tomorrow" — the default must
      // always clear the future-date rule.
      const org = await prisma.organization.findFirstOrThrow()
      const trainedOn = args.trainedOn ?? orgToday(new Date(), org.timezone)
      await grantCertification({ userId: req.userId, equipmentId: req.equipmentId, grantedById: args.byId, trainedOn })
    } catch (e) {
      // A caller-supplied trainedOn can still fail grantCertification's checks
      // (future date) — surface the policy message instead of throwing past the
      // { ok, message } contract.
      if (e instanceof PolicyError) return { ok: false, message: e.message }
      throw e
    }
    await prisma.trainingRequest.update({ where: { id: req.id }, data: { status: 'GRANTED', decidedById: args.byId, decidedAt: new Date() } })
    await notify(req.userId, 'training_decided', { message: `Training granted: you are now certified on ${req.equipment.name}.` })
    await bot.dmUser(req.userId, `You are now certified on ${req.equipment.name}.`, { suppress: true })
  } else {
    await prisma.trainingRequest.update({ where: { id: req.id }, data: { status: 'DECLINED', decidedById: args.byId, decidedAt: new Date(), rejectionReason: args.reason!.trim() } })
    await notify(req.userId, 'training_decided', { message: `Training request for ${req.equipment.name} declined — ${args.reason!.trim()}` })
    await bot.dmUser(req.userId, `Training request for ${req.equipment.name} declined: ${args.reason!.trim()}`, { suppress: true })
  }
  return { ok: true }
}
