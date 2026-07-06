import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, makeUser, makeEquipment } from '../factories'
import { grantCertification, revokeCertification, isCertified } from '@/features/certifications/service'
import { setManagers } from '@/features/equipment/service'

describe('certifications', () => {
  beforeEach(resetDb)

  it('admin grants and revokes; idempotent', async () => {
    const admin = await makeUser({ role: 'admin' })
    const u = await makeUser()
    const eq = await makeEquipment()
    await grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: admin.id })
    await grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: admin.id })
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
    await grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: mgr.id })
    expect(await isCertified(u.id, eq.id)).toBe(true)
    await expect(grantCertification({ userId: u.id, equipmentId: eq.id, grantedById: rando.id })).rejects.toThrow('forbidden')
  })
})
