import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { POST as createRoute } from '@/app/api/bookings/route'

function req(body: unknown) {
  return new Request('http://test/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

describe('POST /api/bookings', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('401 when signed out', async () => {
    const eq = await makeEquipment()
    const res = await createRoute(req({ equipmentId: eq.id, startsAt: hoursFromNow(24), endsAt: hoursFromNow(26), purpose: 'x' }))
    expect(res.status).toBe(401)
  })

  it('201 for a valid instant booking', async () => {
    const u = await makeUser()
    mockUser.current = { ...u, role: u.role }
    const eq = await makeEquipment()
    const res = await createRoute(req({ equipmentId: eq.id, startsAt: hoursFromNow(24), endsAt: hoursFromNow(26), purpose: 'x' }))
    expect(res.status).toBe(201)
    expect((await res.json()).pending).toBe(false)
  })

  it('409 for a taken slot and 422 for a policy block', async () => {
    const u = await makeUser()
    mockUser.current = { ...u, role: u.role }
    const eq = await makeEquipment()
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, purpose: 't', status: 'CONFIRMED', startsAt: hoursFromNow(24), endsAt: hoursFromNow(26) } })
    expect((await createRoute(req({ equipmentId: eq.id, startsAt: hoursFromNow(25), endsAt: hoursFromNow(27), purpose: 'x' }))).status).toBe(409)
    expect((await createRoute(req({ equipmentId: eq.id, startsAt: hoursFromNow(30), endsAt: hoursFromNow(45), purpose: 'x' }))).status).toBe(422) // 15h > 8h cap
  })

  it('400 for malformed body', async () => {
    const u = await makeUser()
    mockUser.current = { ...u, role: u.role }
    expect((await createRoute(req({ equipmentId: 'x' }))).status).toBe(400)
  })
})
