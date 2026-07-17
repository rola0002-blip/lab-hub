import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { resetDb } from '../factories'
import { completeSetup } from '@/app/setup/actions'

const base = {
  orgName: 'TAY LABS', accentColor: '#0d9488', timezone: 'Asia/Singapore',
  adminName: 'Roland', adminEmail: 'pi@lab.test', adminPassword: 'Str0ngPass!123', logo: null,
}

// The gate reads process.env.SETUP_TOKEN at call time (src/lib/setup-token.ts), so vi.stubEnv
// exercises both states without fighting the env singleton.
describe('SETUP_TOKEN bootstrap gate (F1)', () => {
  beforeEach(resetDb)
  afterEach(() => vi.unstubAllEnvs())

  describe('when SETUP_TOKEN is configured', () => {
    beforeEach(() => vi.stubEnv('SETUP_TOKEN', 'correct-horse-battery'))

    it('rejects completeSetup with no token and creates nothing', async () => {
      const r = await completeSetup({ ...base })
      expect(r.ok).toBe(false)
      expect(await prisma.organization.count()).toBe(0)
      expect(await prisma.user.count({ where: { isSystem: false } })).toBe(0)
    })

    it('rejects completeSetup with a wrong token and creates nothing', async () => {
      const r = await completeSetup({ ...base, setupToken: 'nope' })
      expect(r.ok).toBe(false)
      expect(await prisma.organization.count()).toBe(0)
      expect(await prisma.user.count({ where: { isSystem: false } })).toBe(0)
    })

    it('completes setup with the correct token and promotes the admin', async () => {
      const r = await completeSetup({ ...base, setupToken: 'correct-horse-battery' })
      expect(r.ok).toBe(true)
      const org = await prisma.organization.findFirstOrThrow()
      expect(org.setupComplete).toBe(true)
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'pi@lab.test' } })
      expect(admin.role).toBe('admin')
    })

    it('blocks a direct, un-invited sign-up during the incomplete-setup window', async () => {
      // The takeover path: POST straight to the sign-up endpoint before setup completes.
      // No authorized-bootstrap context ⇒ the before-hook must reject it.
      await expect(
        auth.api.signUpEmail({ body: { email: 'attacker@evil.test', password: 'Str0ngPass!123', name: 'X' } }),
      ).rejects.toThrow()
      expect(await prisma.user.count({ where: { isSystem: false } })).toBe(0)
    })
  })

  describe('when SETUP_TOKEN is unset (gate disabled)', () => {
    it('completes setup with no token — behaviour unchanged', async () => {
      const r = await completeSetup({ ...base })
      expect(r.ok).toBe(true)
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'pi@lab.test' } })
      expect(admin.role).toBe('admin')
    })

    it('still allows the first-admin bootstrap sign-up directly', async () => {
      await auth.api.signUpEmail({ body: { email: 'pi@lab.test', password: 'Str0ngPass!123', name: 'PI' } })
      const u = await prisma.user.findUniqueOrThrow({ where: { email: 'pi@lab.test' } })
      expect(u.role).toBe('admin')
    })
  })
})
