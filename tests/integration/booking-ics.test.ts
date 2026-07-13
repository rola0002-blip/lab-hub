import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { GET } from '@/app/api/bookings/[id]/ics/route'

describe('per-booking .ics route', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })
  it('returns a single-VEVENT attachment for the owner and 404 for a stranger', async () => {
    const owner = await makeUser()
    const eq = await makeEquipment({ name: 'AFM' })
    const b = await prisma.booking.create({ data: { userId: owner.id, equipmentId: eq.id, status: 'CONFIRMED', purpose: 'scan', startsAt: new Date(Date.now() + 3_600_000), endsAt: new Date(Date.now() + 7_200_000) } })
    mockUser.current = { id: owner.id, name: owner.name, email: owner.email, role: owner.role }
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: b.id }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    expect((await res.text()).match(/BEGIN:VEVENT/g)?.length).toBe(1)
    const stranger = await makeUser()
    mockUser.current = { id: stranger.id, name: stranger.name, email: stranger.email, role: stranger.role }
    const res2 = await GET(new Request('http://localhost'), { params: Promise.resolve({ id: b.id }) })
    expect(res2.status).toBe(404)
  })
})
