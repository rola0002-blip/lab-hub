import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser } from '../factories'
import { deactivateUser, reactivateUser, setUserRole } from '@/features/people/service'

describe('people service', () => {
  beforeEach(resetDb)
  it('deactivate bans and deletes sessions; reactivate unbans', async () => {
    const u = await makeUser()
    await prisma.session.create({ data: { id: 's1', token: 't1', userId: u.id, expiresAt: new Date(Date.now() + 86_400_000) } })
    await deactivateUser(u.id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).banned).toBe(true)
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0)
    await reactivateUser(u.id)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).banned).toBe(false)
  })
  it('setUserRole updates role', async () => {
    const u = await makeUser({ role: 'guest' })
    await setUserRole(u.id, 'member')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('member')
  })
})
