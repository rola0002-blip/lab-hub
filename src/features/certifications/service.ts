import 'server-only'
import { prisma } from '@/lib/db'
import { isManagerOf } from '@/features/equipment/service'
import { orgToday } from '@/features/issues/due'

async function assertCanManage(byId: string, equipmentId: string) {
  if (!(await isManagerOf(byId, equipmentId))) throw new Error('forbidden')
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
// and fires ONLY when the certification is NEWLY created — the upsert's `update: {}`
// no-op on an existing cert must not log (a re-check of a checked cell stays silent).
// Revoke → re-grant legitimately appends a second record.
export async function grantCertification(args: {
  userId: string; equipmentId: string; grantedById: string
  trainedOn: string; trainedById?: string; note?: string
}): Promise<void> {
  await assertCanManage(args.grantedById, args.equipmentId)
  // Lexicographic yyyy-MM-dd compare against org-tz today (the due.ts convention) —
  // a future training date is a typo, not a plan.
  if (args.trainedOn > orgToday(new Date(), await orgTimezone())) throw new Error('invalid_date')
  await prisma.$transaction(async (tx) => {
    const existing = await tx.certification.findUnique({
      where: { userId_equipmentId: { userId: args.userId, equipmentId: args.equipmentId } },
    })
    await tx.certification.upsert({
      where: { userId_equipmentId: { userId: args.userId, equipmentId: args.equipmentId } },
      update: {},
      create: { userId: args.userId, equipmentId: args.equipmentId, grantedById: args.grantedById },
    })
    if (!existing) {
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
