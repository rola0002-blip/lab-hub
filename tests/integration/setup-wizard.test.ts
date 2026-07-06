import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb } from '../factories'
import { completeSetup } from '@/app/setup/actions'

const input = {
  orgName: 'TAY LABS', accentColor: '#0d9488', timezone: 'Asia/Singapore',
  adminName: 'Roland', adminEmail: 'pi@lab.test', adminPassword: 'Str0ngPass!123', logo: null,
}

describe('setup wizard', () => {
  beforeEach(resetDb)

  it('creates org + admin and locks setup', async () => {
    const r = await completeSetup(input)
    expect(r.ok).toBe(true)
    const org = await prisma.organization.findFirstOrThrow()
    expect(org.setupComplete).toBe(true)
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'pi@lab.test' } })
    expect(admin.role).toBe('admin')
  })

  it('refuses to run twice', async () => {
    await completeSetup(input)
    const r = await completeSetup({ ...input, adminEmail: 'other@lab.test' })
    expect(r.ok).toBe(false)
    expect(await prisma.user.count()).toBe(1)
  })
})
