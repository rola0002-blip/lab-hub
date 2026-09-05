import 'server-only'
import { prisma } from '@/lib/db'
import { isManagerOf } from '@/features/equipment/service'
import { orgToday } from '@/features/issues/due'
import { PolicyError } from './policy'

async function assertCanManage(byId: string, equipmentId: string) {
  if (!(await isManagerOf(byId, equipmentId))) throw new PolicyError('forbidden', 'You can only manage certifications for instruments you manage.')
}

async function orgTimezone(): Promise<string> {
  const org = await prisma.organization.findFirstOrThrow()
  return org.timezone
}

export type TrainingRow = {
  id: string; userId: string; equipmentId: string; userName: string; equipmentName: string
  trainerName: string; trainedOn: string; note: string; createdAt: string
}

// W12-B: granting extends with the training declaration. The record is append-only
// and fires ONLY when the certification is NEWLY created — createMany with
// skipDuplicates (INSERT … ON CONFLICT DO NOTHING) inserts nothing for an existing
// cert, so a re-check of a checked cell stays silent.
// Revoke → re-grant legitimately appends a second record.
export async function grantCertification(args: {
  userId: string; equipmentId: string; grantedById: string
  trainedOn: string; trainedById?: string; note?: string
}): Promise<void> {
  await assertCanManage(args.grantedById, args.equipmentId)
  // Lexicographic yyyy-MM-dd compare against org-tz today (the due.ts convention) —
  // a future training date is a typo, not a plan.
  if (args.trainedOn > orgToday(new Date(), await orgTimezone())) throw new PolicyError('invalid', 'Training date cannot be in the future.')
  await prisma.$transaction(async (tx) => {
    // The service's accepted trainer set must equal the UI's offered set: a real,
    // non-banned, non-system, non-guest human. Trainees stay unrestricted (guests
    // ARE certifiable — pinned behavior).
    const trainer = await tx.user.findUnique({
      where: { id: args.trainedById ?? args.grantedById },
      select: { banned: true, isSystem: true, role: true },
    })
    if (!trainer || trainer.banned || trainer.isSystem || trainer.role === 'guest') {
      throw new PolicyError('invalid', 'Choose a valid trainer.')
    }
    // Atomic novelty probe: createMany … ON CONFLICT DO NOTHING — r.count is the
    // INSERT's own command-tag count, so the race loser deterministically sees 0
    // and skips the record. (A double-Save or two managers granting concurrently
    // can no longer append two records for one grant.)
    const r = await tx.certification.createMany({
      data: [{ userId: args.userId, equipmentId: args.equipmentId, grantedById: args.grantedById }],
      skipDuplicates: true,
    })
    if (r.count === 1) {
      await tx.trainingRecord.create({
        data: {
          userId: args.userId, equipmentId: args.equipmentId,
          trainedById: args.trainedById ?? args.grantedById,
          trainedOn: args.trainedOn, note: (args.note ?? '').slice(0, 500),
        },
      })
    }
  })
}

export async function revokeCertification(args: { userId: string; equipmentId: string; byId: string }): Promise<void> {
  await assertCanManage(args.byId, args.equipmentId)
  await prisma.certification.deleteMany({ where: { userId: args.userId, equipmentId: args.equipmentId } })
}

export async function isCertified(userId: string, equipmentId: string): Promise<boolean> {
  return !!(await prisma.certification.findUnique({ where: { userId_equipmentId: { userId, equipmentId } } }))
}

export async function listTrainingRecords(): Promise<TrainingRow[]> {
  const rows = await prisma.trainingRecord.findMany({
    include: {
      user: { select: { name: true } },
      equipment: { select: { name: true } },
      trainedBy: { select: { name: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  })
  return rows.map((r) => ({
    id: r.id, userId: r.userId, equipmentId: r.equipmentId,
    userName: r.user.name, equipmentName: r.equipment.name, trainerName: r.trainedBy.name,
    trainedOn: r.trainedOn, note: r.note, createdAt: r.createdAt.toISOString(),
  }))
}
