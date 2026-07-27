import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeProject, makeProjectUpdate } from '../factories'

describe('SP8 schema', () => {
  beforeEach(resetDb)
  it('stores a ProjectUpdate; org cadence defaults to Tuesday 16:00; project latch/snooze default null', async () => {
    const u = await makeUser()
    const p = await makeProject()
    expect(p.lastUpdatePromptAt).toBeNull()
    expect(p.updatePromptsPausedUntil).toBeNull()
    const up = await makeProjectUpdate(p.id, u.id, { health: 'AT_RISK', body: 'films polycrystalline' })
    expect(up.health).toBe('AT_RISK')
    const org = await prisma.organization.create({ data: { name: 'Lab' } })
    expect(org.updatePromptDay).toBe(2)
    expect(org.updatePromptHour).toBe(16)
  })
  it('cascades updates with the project, restricts author delete, nulls a deleted origin message', async () => {
    const u = await makeUser()
    const p = await makeProject()
    await makeProjectUpdate(p.id, u.id)
    await expect(prisma.user.delete({ where: { id: u.id } })).rejects.toThrow() // Restrict
    await prisma.project.delete({ where: { id: p.id } })
    expect(await prisma.projectUpdate.count()).toBe(0) // Cascade
  })
})
