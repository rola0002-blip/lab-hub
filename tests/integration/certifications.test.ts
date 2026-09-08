import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser, makeEquipment } from '../factories'
import { prisma } from '@/lib/db'
import { grantCertification, revokeCertification, revokeTrainingRecord, isCertified, listTrainingRecords, listCertRevocations } from '@/features/certifications/service'
import { setManagers } from '@/features/equipment/service'

// W12-B: grantCertification reads the org timezone (orgToday future-date rule), but
// resetDb TRUNCATEs Organization and no factory recreates it — grant every test an org
// (the project-update-service.test.ts pattern).
async function resetWithOrg() {
  await resetDb()
  await prisma.organization.create({ data: { name: 'Lab', timezone: 'Asia/Singapore' } })
}

describe('certifications', () => {
  beforeEach(resetWithOrg)

  it('admin grants and revokes; idempotent', async () => {
    const admin = await makeUser({ role: 'admin' })
    const u = await makeUser()
    const eq = await makeEquipment()
    await grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2020-01-01' })
    await grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2020-01-01' })
    expect(await isCertified(u.id, eq.id)).toBe(true)
    await revokeCertification({ userId: u.id, equipmentId: eq.id, byId: admin.id, reason: 'left the lab' })
    expect(await isCertified(u.id, eq.id)).toBe(false)
  })

  it('manager of the equipment can grant; unrelated member cannot', async () => {
    const mgr = await makeUser({ role: 'member' })
    const rando = await makeUser({ role: 'member' })
    const u = await makeUser({ role: 'guest' })
    const eq = await makeEquipment()
    await setManagers(eq.id, [mgr.id])
    await grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: mgr.id, trainedOn: '2020-01-01' })
    expect(await isCertified(u.id, eq.id)).toBe(true)
    await expect(grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: rando.id, trainedOn: '2020-01-01' })).rejects.toThrow(/manage certifications/)
  })
})

describe('training records (W12-B)', () => {
  beforeEach(resetWithOrg)

  it('grant appends one record; re-grant is a no-op; revoke → re-grant appends again', async () => {
    const admin = await makeUser({ role: 'admin' })
    const trainee = await makeUser()
    const eq = await makeEquipment()
    await grantCertification({ userId: trainee.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2024-01-05' })
    await grantCertification({ userId: trainee.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2024-01-05' })
    expect(await prisma.trainingRecord.count()).toBe(1)
    await revokeCertification({ userId: trainee.id, equipmentId: eq.id, byId: admin.id, reason: 'left the lab' })
    await grantCertification({ userId: trainee.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2025-02-06' })
    const rows = await prisma.trainingRecord.findMany({ orderBy: { createdAt: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[1].trainedOn).toBe('2025-02-06')
  })

  it('records the named trainer and note; rejects future dates', async () => {
    const admin = await makeUser({ role: 'admin' })
    const trainer = await makeUser({ name: 'Senior RA' })
    const trainee = await makeUser()
    const eq = await makeEquipment()
    await grantCertification({ userId: trainee.id, equipmentId: eq.id, grantedById: admin.id, trainedById: trainer.id, trainedOn: '2024-01-05', note: 'hands-on bake' })
    const row = await prisma.trainingRecord.findFirstOrThrow()
    expect(row.trainedById).toBe(trainer.id)
    expect(row.note).toBe('hands-on bake')
    await expect(grantCertification({ userId: trainee.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2999-01-01' })).rejects.toThrow(/cannot be in the future/i)
  })

  it('rejects a guest trainer id (the UI offers non-guests only)', async () => {
    const admin = await makeUser({ role: 'admin' })
    const guest = await makeUser({ role: 'guest' })
    const trainee = await makeUser()
    const eq = await makeEquipment()
    await expect(grantCertification({ userId: trainee.id, equipmentId: eq.id, grantedById: admin.id, trainedById: guest.id, trainedOn: '2024-01-05' })).rejects.toThrow(/valid trainer/)
  })

  it('listTrainingRecords returns the joined DTO', async () => {
    const admin = await makeUser({ role: 'admin' })
    const trainee = await makeUser({ name: 'Trainee One' })
    const eq = await makeEquipment({ name: 'AFM-01' })
    await grantCertification({ userId: trainee.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2024-01-05' })
    const rows = await listTrainingRecords()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userName: 'Trainee One', equipmentName: 'AFM-01', trainerName: admin.name, trainedOn: '2024-01-05' })
  })
})

describe('revocation (W14-A)', () => {
  beforeEach(resetWithOrg)

  it('cert revoke requires a reason, audits the ledger once, and is idempotent', async () => {
    const admin = await makeUser({ role: 'admin' })
    const u = await makeUser()
    const eq = await makeEquipment()
    await grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2024-01-05' })
    await expect(revokeCertification({ userId: u.id, equipmentId: eq.id, byId: admin.id, reason: '   ' })).rejects.toThrow(/reason/i)
    await revokeCertification({ userId: u.id, equipmentId: eq.id, byId: admin.id, reason: 'failed refresher' })
    await revokeCertification({ userId: u.id, equipmentId: eq.id, byId: admin.id, reason: 'second click' }) // idempotent
    expect(await prisma.certificationRevocation.count()).toBe(1)
    const [row] = await prisma.certificationRevocation.findMany()
    expect(row.reason).toBe('failed refresher')
    expect(row.revokedTrainingRecordId).toBeNull()
    expect(row.userId).toBe(u.id)
    // training records survive a cert-only revoke
    expect(await prisma.trainingRecord.count()).toBe(1)
  })

  it('training-record revoke marks the record and cascades the cert revocation', async () => {
    const admin = await makeUser({ role: 'admin' })
    const u = await makeUser()
    const eq = await makeEquipment()
    await grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2024-01-05' })
    const [rec] = await prisma.trainingRecord.findMany()
    await revokeTrainingRecord({ recordId: rec.id, byId: admin.id, reason: 'wrong person recorded' })
    const after = await prisma.trainingRecord.findUniqueOrThrow({ where: { id: rec.id } })
    expect(after.revokedAt).not.toBeNull()
    expect(after.revokeReason).toBe('wrong person recorded')
    expect(await isCertified(u.id, eq.id)).toBe(false)
    const [led] = await prisma.certificationRevocation.findMany()
    expect(led.revokedTrainingRecordId).toBe(rec.id)
    expect(led.reason).toBe('wrong person recorded')
  })

  it('record revoke is idempotent, 404s on bad ids, and gates non-managers', async () => {
    const admin = await makeUser({ role: 'admin' })
    const rando = await makeUser({ role: 'member' })
    const u = await makeUser()
    const eq = await makeEquipment()
    await grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2024-01-05' })
    const [rec] = await prisma.trainingRecord.findMany()
    await expect(revokeTrainingRecord({ recordId: 'nope', byId: admin.id, reason: 'x' })).rejects.toThrow(/not found/i)
    await expect(revokeTrainingRecord({ recordId: rec.id, byId: rando.id, reason: 'x' })).rejects.toThrow(/manage certifications/)
    await expect(revokeTrainingRecord({ recordId: rec.id, byId: admin.id, reason: 'x'.repeat(501) })).rejects.toThrow(/reason/i)
    await revokeTrainingRecord({ recordId: rec.id, byId: admin.id, reason: 'recorded in error' })
    await revokeTrainingRecord({ recordId: rec.id, byId: admin.id, reason: 'second click' }) // no-op
    expect(await prisma.certificationRevocation.count()).toBe(1)
    const rows = await listTrainingRecords()
    expect(rows[0].revokedAt).not.toBeNull()
    expect(rows[0].revokeReason).toBe('recorded in error')
    expect(rows[0].revokedByName).toBe(admin.name)
  })

  it('listCertRevocations returns the joined DTO', async () => {
    const admin = await makeUser({ role: 'admin', name: 'Ada Admin' })
    const u = await makeUser({ name: 'Trainee' })
    const eq = await makeEquipment({ name: 'SEM' })
    await grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: admin.id, trainedOn: '2024-01-05' })
    await revokeCertification({ userId: u.id, equipmentId: eq.id, byId: admin.id, reason: 'safety lapse' })
    const rows = await listCertRevocations()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userName: 'Trainee', equipmentName: 'SEM', revokedByName: 'Ada Admin', reason: 'safety lapse' })
    expect(rows[0].revokedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(rows[0].revokedTrainingRecordId).toBeNull()
  })
})
