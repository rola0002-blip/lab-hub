import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'
import { countPendingApprovals } from '@/features/booking/service'
import { countPendingRequests } from '@/features/certifications/training-request-service'
import { loadNavCounts } from '@/lib/nav-counts'

vi.mock('@/lib/session', () => ({ getSessionUser: vi.fn(async () => null) }))
import { getSessionUser } from '@/lib/session'
import { GET } from '@/app/api/nav-counts/route'

const pending = (userId: string, equipmentId: string, over: Record<string, unknown> = {}) =>
  prisma.booking.create({ data: { userId, equipmentId, purpose: 'p', status: 'PENDING', startsAt: hoursFromNow(24), endsAt: hoursFromNow(26), ...over } })

describe('nav counts (W20-D)', () => {
  beforeEach(resetDb)

  it('approvals: admin sees every pending card, a recurring series counts once, decided rows never', async () => {
    const admin = await makeUser({ role: 'admin' })
    const u = await makeUser()
    const sem = await makeEquipment({ name: 'SEM' })
    const rule = await prisma.recurrenceRule.create({ data: { equipmentId: sem.id, userId: u.id, daysOfWeek: [1], startMinutes: 600, durationMinutes: 60, firstDate: '2026-11-02', untilDate: '2026-11-16' } })
    await pending(u.id, sem.id)
    for (let i = 0; i < 3; i++) await pending(u.id, sem.id, { recurrenceRuleId: rule.id, startsAt: hoursFromNow(48 + i * 168), endsAt: hoursFromNow(49 + i * 168) })
    await pending(u.id, sem.id, { status: 'CONFIRMED', startsAt: hoursFromNow(30), endsAt: hoursFromNow(31) })
    expect(await countPendingApprovals(admin)).toBe(2)
  })

  it('approvals: a manager sees only managed instruments; a member managing nothing and a guest see 0', async () => {
    const mgr = await makeUser()
    const member = await makeUser()
    const guest = await makeUser({ role: 'guest' })
    const sem = await makeEquipment({ name: 'SEM' })
    const tem = await makeEquipment({ name: 'TEM' })
    await prisma.equipmentManager.create({ data: { userId: mgr.id, equipmentId: sem.id } })
    await pending(member.id, sem.id)
    await pending(member.id, tem.id)
    expect(await countPendingApprovals(mgr)).toBe(1)
    expect(await countPendingApprovals(member)).toBe(0)
    expect(await countPendingApprovals(guest)).toBe(0)
  })

  it('training requests: admin only unmanaged instruments, manager own instruments, decided excluded, guest 0', async () => {
    const admin = await makeUser({ role: 'admin' })
    const mgr = await makeUser()
    const guest = await makeUser({ role: 'guest' })
    const a = await makeUser(); const b = await makeUser()
    const xps = await makeEquipment({ name: 'XPS' })
    const afm = await makeEquipment({ name: 'AFM' })
    await prisma.equipmentManager.create({ data: { userId: mgr.id, equipmentId: xps.id } })
    await prisma.trainingRequest.create({ data: { userId: a.id, equipmentId: xps.id } })
    await prisma.trainingRequest.create({ data: { userId: b.id, equipmentId: afm.id } })
    await prisma.trainingRequest.create({ data: { userId: b.id, equipmentId: xps.id, status: 'GRANTED' } })
    expect(await countPendingRequests(admin)).toBe(1) // AFM only — XPS has an active manager (W21-A)
    expect(await countPendingRequests(mgr)).toBe(1)
    expect(await countPendingRequests(guest)).toBe(0)
  })

  it('loadNavCounts bundles both; guests short-circuit to zeros', async () => {
    const admin = await makeUser({ role: 'admin' })
    const sem = await makeEquipment({ name: 'SEM' })
    await pending(admin.id, sem.id)
    expect(await loadNavCounts(admin)).toEqual({ approvals: 1, trainingRequests: 0 })
    expect(await loadNavCounts({ id: 'nobody', role: 'guest' })).toEqual({ approvals: 0, trainingRequests: 0 })
  })

  it('GET /api/nav-counts: 401 without a session, the counts with one', async () => {
    expect((await GET()).status).toBe(401)
    const admin = await makeUser({ role: 'admin' })
    vi.mocked(getSessionUser).mockResolvedValueOnce({ id: admin.id, name: admin.name, email: admin.email, role: 'admin' })
    const r = await GET()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ approvals: 0, trainingRequests: 0 })
  })
})
