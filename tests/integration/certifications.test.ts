import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser, makeEquipment } from '../factories'
import { prisma } from '@/lib/db'
import { grantCertification, revokeCertification, isCertified, listTrainingRecords } from '@/features/certifications/service'
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
    await revokeCertification({ userId: u.id, equipmentId: eq.id, byId: admin.id })
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
    await revokeCertification({ userId: trainee.id, equipmentId: eq.id, byId: admin.id })
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
