import 'server-only'
import { prisma } from '@/lib/db'
import { isManagerOf } from '@/features/equipment/service'
import { orgToday, orgDate } from '@/features/issues/due'
import { PolicyError } from './policy'

async function assertCanManage(byId: string, equipmentId: string) {
  if (!(await isManagerOf(byId, equipmentId))) throw new PolicyError('forbidden', 'You can only manage certifications for instruments you manage.')
}

function assertReason(reason: string): string {
  const r = reason.trim()
  if (!r || r.length > 500) throw new PolicyError('invalid', 'Provide a revocation reason (1–500 characters).')
  return r
}

async function orgTimezone(): Promise<string> {
  const org = await prisma.organization.findFirstOrThrow()
  return org.timezone
}

export type TrainingRow = {
  id: string; userId: string; equipmentId: string; userName: string; equipmentName: string
  trainerName: string; trainedOn: string; note: string; createdAt: string
  revokedAt: string | null; revokeReason: string | null; revokedByName: string | null
}

export type RevocationRow = {
  id: string; userId: string; userName: string; equipmentId: string; equipmentName: string
  revokedById: string; revokedByName: string; reason: string
  revokedAt: string; revokedOn: string; revokedTrainingRecordId: string | null
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

// W14-A: revocation is AUDITED. The cert row is still hard-deleted (every reader of
// cert state — booking gates, catalogue chips, exports — stays as-is), but only the
// WINNING delete (count = 1) appends a ledger row: an idempotent second revoke of an
// already-revoked pair is a no-op, never a phantom entry. Training records are
// deliberately untouched here — the person WAS trained; only the certification is
// withdrawn (the unified ledger shows both events separately).
export async function revokeCertification(args: { userId: string; equipmentId: string; byId: string; reason: string }): Promise<void> {
  await assertCanManage(args.byId, args.equipmentId)
  const reason = assertReason(args.reason)
  await prisma.$transaction(async (tx) => {
    const r = await tx.certification.deleteMany({ where: { userId: args.userId, equipmentId: args.equipmentId } })
    if (r.count === 1) {
      await tx.certificationRevocation.create({
        data: { userId: args.userId, equipmentId: args.equipmentId, revokedById: args.byId, reason },
      })
    }
  })
}

// W14-A (D2 cascade): annulling a training record (recorded in error) also revokes
// the certification it underwrote — but ONLY if the cert still exists; a cert already
// separately revoked produces no second ledger row (the count=1 guard again).
// Idempotent: revoking an already-annulled record is a no-op.
export async function revokeTrainingRecord(args: { recordId: string; byId: string; reason: string }): Promise<void> {
  const reason = assertReason(args.reason)
  const record = await prisma.trainingRecord.findUnique({
    where: { id: args.recordId },
    select: { id: true, userId: true, equipmentId: true, revokedAt: true },
  })
  if (!record) throw new PolicyError('not_found', 'Training record not found.')
  await assertCanManage(args.byId, record.equipmentId)
  if (record.revokedAt) return
  await prisma.$transaction(async (tx) => {
    await tx.trainingRecord.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), revokedById: args.byId, revokeReason: reason },
    })
    const c = await tx.certification.deleteMany({ where: { userId: record.userId, equipmentId: record.equipmentId } })
    if (c.count === 1) {
      await tx.certificationRevocation.create({
        data: { userId: record.userId, equipmentId: record.equipmentId, revokedById: args.byId, reason, revokedTrainingRecordId: record.id },
      })
    }
  })
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
      revokedBy: { select: { name: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  })
  return rows.map((r) => ({
    id: r.id, userId: r.userId, equipmentId: r.equipmentId,
    userName: r.user.name, equipmentName: r.equipment.name, trainerName: r.trainedBy.name,
    trainedOn: r.trainedOn, note: r.note, createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt?.toISOString() ?? null,
    revokeReason: r.revokeReason,
    revokedByName: r.revokedBy?.name ?? null,
  }))
}

// The certification-revocation half of the unified ledger (W14-A). revokedOn is the
// org-tz yyyy-MM-dd rendering (orgDate) so it sorts and displays beside trainedOn.
export async function listCertRevocations(): Promise<RevocationRow[]> {
  const tz = await orgTimezone()
  const rows = await prisma.certificationRevocation.findMany({
    include: {
      user: { select: { name: true } },
      equipment: { select: { name: true } },
      revokedBy: { select: { name: true } },
    },
    orderBy: [{ revokedAt: 'desc' }, { id: 'desc' }],
    take: 100,
  })
  return rows.map((r) => ({
    id: r.id, userId: r.userId, userName: r.user.name,
    equipmentId: r.equipmentId, equipmentName: r.equipment.name,
    revokedById: r.revokedById, revokedByName: r.revokedBy.name, reason: r.reason,
    revokedAt: r.revokedAt.toISOString(), revokedOn: orgDate(r.revokedAt, tz),
    revokedTrainingRecordId: r.revokedTrainingRecordId,
  }))
}
