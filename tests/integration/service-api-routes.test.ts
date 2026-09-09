import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, makeIssue, makeLabel, makeProject, hoursFromNow } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { GET as equipmentGET } from '@/app/api/equipment/route'
import { GET as bookingsGET } from '@/app/api/bookings/route'
import { GET as projectsGET, POST as projectsPOST } from '@/app/api/projects/route'
import { PATCH as issuePATCH } from '@/app/api/issues/[id]/route'

const jreq = (method: string, url: string, body?: unknown) =>
  new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

describe('GET /api/equipment', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('401 when signed out', async () => {
    expect((await equipmentGET()).status).toBe(401)
  })

  it('lists ACTIVE equipment only, with policy fields and manager ids', async () => {
    const u = await makeUser({ role: 'member' }); mockUser.current = { ...u, role: u.role }
    const active = await makeEquipment({ approvalPolicy: 'ALL', certificationRequired: true, allowRecurring: true })
    await makeEquipment({ status: 'RETIRED' })
    await prisma.equipmentManager.create({ data: { userId: u.id, equipmentId: active.id } })

    const res = await equipmentGET()
    expect(res.status).toBe(200)
    const { equipment } = await res.json()
    expect(equipment).toHaveLength(1)
    expect(equipment[0]).toMatchObject({
      id: active.id, name: active.name, status: 'ACTIVE', approvalPolicy: 'ALL',
      certificationRequired: true, allowRecurring: true,
      maxDurationMinutes: active.maxDurationMinutes, advanceBookingDays: active.advanceBookingDays,
      managerIds: [u.id],
    })
  })
})

describe('GET /api/bookings', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('401 when signed out', async () => {
    expect((await bookingsGET(new Request('http://t/api/bookings'))).status).toBe(401)
  })

  it('returns bookings overlapping the default [now, now+7d) window and no others', async () => {
    const u1 = await makeUser({ name: 'One' })
    const u2 = await makeUser({ name: 'Two' })
    mockUser.current = { ...u1, role: u1.role }
    // One equipment per booking: the booking_no_overlap exclusion constraint
    // (PENDING/CONFIRMED per instrument) forbids stacked fixtures on one row set.
    const mk = async (userId: string, startsAt: Date, endsAt: Date) => {
      const eq = await makeEquipment()
      return prisma.booking.create({ data: { userId, equipmentId: eq.id, purpose: 'p', status: 'CONFIRMED', startsAt, endsAt } })
    }
    // One Date per instant, shared by fixture and assertion — recomputing
    // hoursFromNow drifts by ms between the create and the compare.
    const inWindowStart = hoursFromNow(24)
    await mk(u1.id, inWindowStart, hoursFromNow(26))
    await mk(u2.id, hoursFromNow(24 + 24 * 8), hoursFromNow(26 + 24 * 8)) // 8 days out — beyond the 7d default
    await mk(u2.id, hoursFromNow(-48), hoursFromNow(-24)) // past

    const res = await bookingsGET(new Request('http://t/api/bookings'))
    expect(res.status).toBe(200)
    const { bookings } = await res.json()
    expect(bookings).toHaveLength(1)
    expect(bookings[0]).toMatchObject({ userId: u1.id, userName: 'One', purpose: 'p', status: 'CONFIRMED' })
    expect(bookings[0].startsAt).toEqual(inWindowStart.toISOString())
  })

  it('excludes CANCELLED/REJECTED by default; status= overrides; invalid status 400s', async () => {
    const u = await makeUser({ role: 'member' }); mockUser.current = { ...u, role: u.role }
    const mk = async (status: string) => {
      const eq = await makeEquipment()
      return prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, purpose: 'p', status: status as never, startsAt: hoursFromNow(10), endsAt: hoursFromNow(12) } })
    }
    await mk('CONFIRMED')
    await mk('CANCELLED')
    await mk('REJECTED')

    const def = await (await bookingsGET(new Request('http://t/api/bookings'))).json()
    expect(def.bookings).toHaveLength(1)
    expect(def.bookings[0].status).toBe('CONFIRMED')

    const withCancelled = await (await bookingsGET(new Request('http://t/api/bookings?status=CONFIRMED,CANCELLED'))).json()
    expect(withCancelled.bookings).toHaveLength(2)

    expect((await bookingsGET(new Request('http://t/api/bookings?status=BOGUS'))).status).toBe(400)
  })

  it('overlap is half-open: a booking ending at `from` or starting at `to` is excluded', async () => {
    const u = await makeUser({ role: 'member' }); mockUser.current = { ...u, role: u.role }
    // Shared Date objects: the boundaries must land on the SAME instant in the
    // fixtures and the query, or ms drift turns a touching range into an overlap.
    const from = hoursFromNow(24)
    const to = hoursFromNow(48)
    const mk = async (startsAt: Date, endsAt: Date) => {
      const eq = await makeEquipment()
      return prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, purpose: 'p', status: 'CONFIRMED', startsAt, endsAt } })
    }
    const inside = await mk(new Date(from.getTime() + 3_600_000), new Date(to.getTime() - 3_600_000))
    await mk(new Date(from.getTime() - 4 * 3_600_000), from) // ends exactly at from
    await mk(to, new Date(to.getTime() + 12 * 3_600_000)) // starts exactly at to
    const spanning = await mk(new Date(from.getTime() - 24 * 3_600_000), new Date(to.getTime() + 52 * 3_600_000))

    const url = `http://t/api/bookings?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
    const { bookings } = await (await bookingsGET(new Request(url))).json()
    expect(bookings.map((b: { id: string }) => b.id).sort()).toEqual([inside.id, spanning.id].sort())
  })

  it('equipmentId filter and mine=1 scope to the caller', async () => {
    const u1 = await makeUser()
    const u2 = await makeUser()
    mockUser.current = { ...u1, role: u1.role }
    const eqA = await makeEquipment()
    const eqB = await makeEquipment()
    const mk = (userId: string, equipmentId: string, from: number, to: number) =>
      prisma.booking.create({ data: { userId, equipmentId, purpose: 'p', status: 'PENDING', startsAt: hoursFromNow(from), endsAt: hoursFromNow(to) } })
    await mk(u1.id, eqA.id, 10, 12)
    await mk(u1.id, eqB.id, 14, 16)
    await mk(u2.id, eqA.id, 18, 20)

    const byEq = await (await bookingsGET(new Request(`http://t/api/bookings?equipmentId=${eqA.id}`))).json()
    expect(byEq.bookings).toHaveLength(2)

    const mine = await (await bookingsGET(new Request('http://t/api/bookings?mine=1'))).json()
    expect(mine.bookings).toHaveLength(2)
    expect(mine.bookings.every((b: { userId: string }) => b.userId === u1.id)).toBe(true)

    const mineFalse = await (await bookingsGET(new Request('http://t/api/bookings?mine=0'))).json()
    expect(mineFalse.bookings).toHaveLength(3)
  })

  it('400 for from>to, a non-boolean mine, and a garbage date', async () => {
    const u = await makeUser({ role: 'member' }); mockUser.current = { ...u, role: u.role }
    expect((await bookingsGET(new Request(`http://t/api/bookings?from=${encodeURIComponent(hoursFromNow(48).toISOString())}&to=${encodeURIComponent(hoursFromNow(24).toISOString())}`))).status).toBe(400)
    expect((await bookingsGET(new Request('http://t/api/bookings?mine=yes'))).status).toBe(400)
    expect((await bookingsGET(new Request('http://t/api/bookings?from=not-a-date'))).status).toBe(400)
  })
})

describe('GET/POST /api/projects', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('401 when signed out', async () => {
    expect((await projectsGET()).status).toBe(401)
    expect((await projectsPOST(jreq('POST', 'http://t/api/projects', { name: 'x' }))).status).toBe(401)
  })

  it('member creates a project (201) and it appears in the list', async () => {
    const m = await makeUser({ role: 'member' }); mockUser.current = { ...m, role: m.role }
    const res = await projectsPOST(jreq('POST', 'http://t/api/projects', { name: 'CVD campaign', description: 'growth runs' }))
    expect(res.status).toBe(201)
    const { project } = await res.json()
    expect(project.name).toBe('CVD campaign')

    const list = await (await projectsGET()).json()
    expect(list.projects.map((p: { id: string }) => p.id)).toContain(project.id)
    expect(list.projects[0]).toMatchObject({ id: project.id, name: 'CVD campaign', description: 'growth runs', status: 'ACTIVE' })
  })

  it('guest POST is 403 forbidden; a bad body is 400; an unknown lead is 422 invalid', async () => {
    const guest = await makeUser({ role: 'guest' }); mockUser.current = { ...guest, role: guest.role }
    const denied = await projectsPOST(jreq('POST', 'http://t/api/projects', { name: 'nope' }))
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ error: 'forbidden' })

    const m = await makeUser({ role: 'member' }); mockUser.current = { ...m, role: m.role }
    expect((await projectsPOST(jreq('POST', 'http://t/api/projects', { description: 'no name' }))).status).toBe(400)
    expect((await projectsPOST(jreq('POST', 'http://t/api/projects', { name: 'x', leadId: 'missing-user' }))).status).toBe(422)
  })
})

describe('PATCH /api/issues/[id]', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  const patch = (id: string, body: unknown) =>
    issuePATCH(jreq('PATCH', `http://t/api/issues/${id}`, body), { params: Promise.resolve({ id }) })

  it('401 when signed out', async () => {
    const u = await makeUser()
    const iss = await makeIssue(u.id)
    expect((await patch(iss.id, { title: 'x' })).status).toBe(401)
  })

  it('member patches every field and gets the updated IssueDto back', async () => {
    const m = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })
    mockUser.current = { ...m, role: m.role }
    const iss = await makeIssue(m.id, { status: 'TODO', priority: 'NONE' })
    const project = await makeProject()
    const label = await makeLabel()

    const res = await patch(iss.id, {
      title: 'Calibrate SEM', description: 'updated body', status: 'IN_PROGRESS', priority: 'HIGH',
      assigneeId: other.id, projectId: project.id, dueDate: '2026-10-01T00:00:00.000Z', labelIds: [label.id],
    })
    expect(res.status).toBe(200)
    const { issue } = await res.json()
    expect(issue).toMatchObject({
      id: iss.id, title: 'Calibrate SEM', description: 'updated body',
      status: 'IN_PROGRESS', priority: 'HIGH', dueDate: '2026-10-01T00:00:00.000Z',
    })
    expect(issue.assignee.id).toBe(other.id)
    expect(issue.project.id).toBe(project.id)
    expect(issue.labels.map((l: { id: string }) => l.id)).toEqual([label.id])
  })

  it('nullish fields clear: assigneeId/dueDate null, and labelIds: [] empties the set', async () => {
    const m = await makeUser({ role: 'member' })
    const other = await makeUser({ role: 'member' })
    mockUser.current = { ...m, role: m.role }
    const label = await makeLabel()
    const iss = await makeIssue(m.id, { assigneeId: other.id, dueDate: new Date('2026-10-01T00:00:00Z') })
    await prisma.issueLabel.create({ data: { issueId: iss.id, labelId: label.id } })

    const res = await patch(iss.id, { assigneeId: null, dueDate: null, labelIds: [] })
    expect(res.status).toBe(200)
    const { issue } = await res.json()
    expect(issue.assignee).toBeNull()
    expect(issue.dueDate).toBeNull()
    expect(issue.labels).toEqual([])
  })

  it('guest is 403; unknown id is 404; empty or invalid body is 400', async () => {
    const guest = await makeUser({ role: 'guest' })
    const owner = await makeUser({ role: 'member' })
    const iss = await makeIssue(owner.id)
    mockUser.current = { ...guest, role: guest.role }
    expect((await patch(iss.id, { title: 'nope' })).status).toBe(403)

    mockUser.current = { ...owner, role: owner.role }
    expect((await patch('missing-id', { title: 'x' })).status).toBe(404)
    expect((await patch(iss.id, {})).status).toBe(400)
    expect((await patch(iss.id, { status: 'NOT_A_STATUS' })).status).toBe(400)
  })
})
