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

  it('serializes concurrent first-runs to a single Organization row', async () => {
    // Five simultaneous first-run submissions. Without the advisory-lock guard each
    // racer's findFirst returns null and each creates its own Organization row,
    // breaking the "One Organization row" invariant. The lock must collapse them to
    // exactly one row. (admin-user creation is outside the lock — accepted residual.)
    const racers = Array.from({ length: 5 }, (_, i) =>
      completeSetup({ ...input, adminEmail: `admin${i}@lab.test` }),
    )
    await Promise.allSettled(racers)
    expect(await prisma.organization.count()).toBe(1)
    const org = await prisma.organization.findFirstOrThrow()
    expect(org.setupComplete).toBe(true)
  })
})
