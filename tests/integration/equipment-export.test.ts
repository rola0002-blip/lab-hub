import { describe, it, expect, beforeEach, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))

import { GET } from '@/app/api/equipment/[id]/export/route'

const signIn = (u: { id: string; name: string; email: string; role: string }) => {
  mockUser.current = { id: u.id, name: u.name, email: u.email, role: u.role }
}
const call = (id: string) => GET(new Request('http://x/api'), { params: Promise.resolve({ id }) })

// exceljs's typings declare their own module-local `interface Buffer extends
// ArrayBuffer` — nominally incompatible with Node's Buffer. Bridge through the
// parameter's own type instead of guessing at theirs.
const parseWorkbook = async (res: Response): Promise<ExcelJS.Workbook> => {
  const wb = new ExcelJS.Workbook()
  const buf = Buffer.from(await res.arrayBuffer())
  await wb.xlsx.load(buf as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0])
  return wb
}

describe('equipment records export route', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  async function seed() {
    const admin = await makeUser({ role: 'admin', name: 'Alice Admin' })
    const member = await makeUser({ role: 'member', name: 'Mira Member' })
    const trainer = await makeUser({ role: 'member', name: 'Ted Trainer' })
    const eq = await makeEquipment({ name: 'PECVD' })
    await prisma.booking.create({ data: {
      userId: member.id, equipmentId: eq.id, status: 'CONFIRMED', purpose: 'grow hBN',
      startsAt: new Date('2026-09-01T02:00:00Z'), endsAt: new Date('2026-09-01T05:00:00Z'),
      decidedById: admin.id, decidedAt: new Date('2026-08-30T06:00:00Z'),
      sessionStartedAt: new Date('2026-09-01T02:05:00Z'), sessionEndedAt: new Date('2026-09-01T04:55:00Z'),
      sessionNote: 'stage heater acting up',
    } })
    await prisma.certification.create({ data: { userId: member.id, equipmentId: eq.id, grantedById: admin.id } })
    await prisma.trainingRecord.create({ data: {
      userId: member.id, equipmentId: eq.id, trainedById: trainer.id, trainedOn: '2026-08-30', note: 'hands-on pump down',
    } })
    await prisma.trainingRecord.create({ data: {
      userId: member.id, equipmentId: eq.id, trainedById: trainer.id, trainedOn: '2026-09-01', note: 'superseded session',
      revokedAt: new Date('2026-09-02T01:00:00Z'), revokedById: admin.id, revokeReason: 'recorded in error',
    } })
    return { admin, member, trainer, eq }
  }

  it('admin exports a 3-sheet workbook with resolved names', async () => {
    const { admin, eq } = await seed()
    signIn(admin)
    const res = await call(eq.id)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('content-disposition')).toContain('labhub-pecvd-records.xlsx')
    const wb = await parseWorkbook(res)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Bookings', 'Training records', 'Certifications'])
    const bookings = wb.getWorksheet('Bookings')!
    expect(bookings.getRow(1).getCell(1).value).toBe('When')
    expect(bookings.getRow(2).getCell(2).value).toBe('Mira Member')
    expect(bookings.getRow(2).getCell(8).value).toBe('stage heater acting up')
    expect(bookings.getRow(2).getCell(9).value).toBe('Alice Admin') // decidedById resolved from the bare-id map
    // no Organization row in this test — this asserts the 'Asia/Singapore' fallback tz; the minimal-state test below covers the org-present path
    expect(bookings.getRow(2).getCell(1).value).toBe('Tue 1 Sep, 10:00–13:00') // org-tz (UTC+8) formatted window: 02:00Z renders 10:00
    const training = wb.getWorksheet('Training records')!
    expect(training.getRow(2).getCell(4).value).toBe('Ted Trainer')
    // W14-A: Revoked/Reason columns (cells 6/7). Locate rows by their Date business
    // key rather than coupling to insert order.
    const revokedRow = [2, 3].map((n) => training.getRow(n)).find((row) => row.getCell(1).value === '2026-09-01')!
    const activeRow = [2, 3].map((n) => training.getRow(n)).find((row) => row.getCell(1).value === '2026-08-30')!
    expect(revokedRow.getCell(6).value).toBe('2 Sep 2026, 9:00 AM') // org-tz (UTC+8): 01:00Z renders 9:00 AM
    expect(revokedRow.getCell(7).value).toBe('recorded in error')
    expect(activeRow.getCell(6).value).toBe('')
    expect(activeRow.getCell(7).value).toBe('')
    const certs = wb.getWorksheet('Certifications')!
    expect(certs.getRow(2).getCell(1).value).toBe('Mira Member')
    expect(certs.getRow(2).getCell(3).value).toBe('Alice Admin') // grantedById resolved
  })

  it('an equipment manager (non-admin) may export', async () => {
    const { member, eq } = await seed()
    await prisma.equipmentManager.create({ data: { userId: member.id, equipmentId: eq.id } })
    signIn(member)
    expect((await call(eq.id)).status).toBe(200)
  })

  it('a plain member, a guest, and a signed-out caller all get 404 (no leak)', async () => {
    const { member, eq } = await seed()
    const guest = await makeUser({ role: 'guest', name: 'Gus Guest' })
    for (const u of [member, guest, null]) {
      mockUser.current = u ? { id: u.id, name: u.name, email: u.email, role: u.role } : null
      expect((await call(eq.id)).status).toBe(404)
    }
  })

  it('unknown equipment: identical 404 for admin and member', async () => {
    const admin = await makeUser({ role: 'admin' })
    const member = await makeUser({ role: 'member' })
    for (const u of [admin, member]) {
      signIn(u)
      expect((await call('does-not-exist')).status).toBe(404)
    }
  })

  it('renders minimal and dangling-id states under an org timezone', async () => {
    // The other tests rely on the 'Asia/Singapore' fallback (resetDb TRUNCATEs
    // Organization and they never recreate it). Creating the org INSIDE this test
    // isolates it and exercises the org-present tz path that production always runs.
    await prisma.organization.create({ data: { name: 'Fix Lab', timezone: 'Asia/Tokyo' } })
    const admin = await makeUser({ role: 'admin', name: 'Alice Admin' })
    const member = await makeUser({ role: 'member', name: 'Mira Member' })
    const eqA = await makeEquipment({ name: 'Min A' })
    const eqB = await makeEquipment({ name: 'Ghost B' })
    // eqA: PENDING, no decision, no session — the most common real-world state.
    await prisma.booking.create({ data: {
      userId: member.id, equipmentId: eqA.id, status: 'PENDING', purpose: 'pending only',
      startsAt: new Date('2026-09-01T02:00:00Z'), endsAt: new Date('2026-09-01T05:00:00Z'),
    } })
    // eqB: REJECTED with a dangling decidedById (bare string, no user row) plus a
    // rejectionReason — covers the null-branch inversion of every decidedById map miss.
    await prisma.booking.create({ data: {
      userId: member.id, equipmentId: eqB.id, status: 'REJECTED', purpose: 'ghost approver',
      startsAt: new Date('2026-09-02T02:00:00Z'), endsAt: new Date('2026-09-02T03:00:00Z'),
      rejectionReason: 'asked to stop', decidedById: 'deleted-user',
      decidedAt: new Date('2026-09-01T06:00:00Z'),
    } })

    signIn(admin)
    const wbA = await parseWorkbook(await call(eqA.id))
    const bookingsA = wbA.getWorksheet('Bookings')!
    // 02:00Z renders 11:00 in Asia/Tokyo — org-present tz path (fallback test above covers UTC+8).
    expect(bookingsA.getRow(2).getCell(1).value).toBe('Tue 1 Sep, 11:00–14:00')
    // No session, no decision, no rejection: every optional cell takes its '' branch.
    expect(bookingsA.getRow(2).getCell(6).value).toBe('')
    expect(bookingsA.getRow(2).getCell(7).value).toBe('')
    expect(bookingsA.getRow(2).getCell(8).value).toBe('')
    expect(bookingsA.getRow(2).getCell(9).value).toBe('')
    expect(bookingsA.getRow(2).getCell(10).value).toBe('')
    expect(bookingsA.getRow(2).getCell(11).value).toBe('')
    // No trainings or certs on eqA: exceljs counts the header row, so header-only sheets are 1.
    expect(wbA.getWorksheet('Training records')!.rowCount).toBe(1)
    expect(wbA.getWorksheet('Certifications')!.rowCount).toBe(1)
    // Header + the single pending booking, nothing else.
    expect(bookingsA.rowCount).toBe(2)

    const wbB = await parseWorkbook(await call(eqB.id))
    const bookingsB = wbB.getWorksheet('Bookings')!
    // Dangling decidedById: name lookup misses → blank, not a crash, not the raw id.
    expect(bookingsB.getRow(2).getCell(9).value).toBe('')
    // 06:00Z → 15:00 Tokyo; formatDateTime emits 'd MMM yyyy, h:mm a' → '3:00 PM' + year.
    expect(String(bookingsB.getRow(2).getCell(10).value)).toContain('2026')
    expect(String(bookingsB.getRow(2).getCell(10).value)).toContain('3:00 PM')
    expect(bookingsB.getRow(2).getCell(11).value).toBe('asked to stop')
  })
})
