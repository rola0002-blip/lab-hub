import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import ExcelJS from 'exceljs'
import { resetDb, makeUser, makeDocumentFolder, makeDocument, makeRaAcknowledgment } from '../factories'

const mockUser = vi.hoisted(() => ({ current: null as null | { id: string; name: string; email: string; role: string } }))
vi.mock('@/lib/session', () => ({
  getSessionUser: async () => mockUser.current,
  requireUser: async () => mockUser.current,
  requireAdmin: async () => mockUser.current,
}))
// revalidatePath throws "outside a request scope" when a Server Action is invoked
// directly in Vitest — stub it (we assert the action's return value, not caching).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { submitRaAction, revokeRaAction } from '@/app/(app)/ra/actions'
import { GET } from '@/app/api/ra/acknowledgments/export/route'

const signIn = (u: { id: string; name: string; email: string; role: string }) => {
  mockUser.current = { id: u.id, name: u.name, email: u.email, role: u.role }
}

// The actions are the ONLY place the service's throws become UI copy. Every failure
// here must come back as `{ ok:false, message }` — the files/actions.ts fail() idiom
// does NOT rethrow, so a rejected promise from any of these is a regression.
describe('RA server actions', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('submitRaAction: a member acknowledges an RA document and the row lands', async () => {
    const member = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const doc = await makeDocument(member.id, { folderId: folder.id, name: 'cvd-ra.pdf' })
    signIn(member)
    expect(await submitRaAction([doc.id], 'NTU2026ABS')).toEqual({ ok: true, recorded: 1 })
    const row = await prisma.raAcknowledgment.findFirstOrThrow({ where: { userId: member.id, documentId: doc.id } })
    expect(row.matricNumber).toBe('NTU2026ABS')
    expect(row.documentName).toBe('cvd-ra.pdf') // snapshotted, not joined
  })

  it('submitRaAction: a bulk submit of two docs records both in one call', async () => {
    const member = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const d1 = await makeDocument(member.id, { folderId: folder.id, name: 'a.pdf' })
    const d2 = await makeDocument(member.id, { folderId: folder.id, name: 'b.pdf' })
    signIn(member)
    expect(await submitRaAction([d1.id, d2.id], 'NTU2026ABS')).toEqual({ ok: true, recorded: 2 })
    expect(await prisma.raAcknowledgment.count({ where: { userId: member.id } })).toBe(2)
  })

  it('submitRaAction: a document outside the RA folder is refused with the pick-from-list message', async () => {
    const member = await makeUser({ role: 'member' })
    await makeDocumentFolder({ name: 'RA' })
    const other = await makeDocumentFolder()
    const foreign = await makeDocument(member.id, { folderId: other.id })
    signIn(member)
    expect(await submitRaAction([foreign.id], 'A1')).toEqual({ ok: false, message: 'Pick RA documents from the list.' })
    expect(await prisma.raAcknowledgment.count()).toBe(0)
  })

  it('submitRaAction: a forged non-array documentIds degrades to a result, never a rejected promise', async () => {
    const member = await makeUser({ role: 'member' })
    await makeDocumentFolder({ name: 'RA' })
    signIn(member)
    // pinned from zod v4's first issue for { documentIds: 42 } — "Invalid input:
    // expected array, received number" (en locale default).
    expect(await submitRaAction(42 as never, 'A1')).toEqual({ ok: false, message: 'Invalid input: expected array, received number' })
    expect(await prisma.raAcknowledgment.count()).toBe(0)
  })

  it('submitRaAction: 101 ids degrade to the at-most-100 message, never a rejected promise', async () => {
    const member = await makeUser({ role: 'member' })
    await makeDocumentFolder({ name: 'RA' })
    signIn(member)
    expect(await submitRaAction(Array.from({ length: 101 }, (_, i) => `d${i}`), 'A1'))
      .toEqual({ ok: false, message: 'Pick at most 100 RA documents.' })
    expect(await prisma.raAcknowledgment.count()).toBe(0)
  })

  describe('revokeRaAction', () => {
    it('returns ok:true and deletes the row for the author', async () => {
      const m = await makeUser({ role: 'member' })
      mockUser.current = m
      const folder = await makeDocumentFolder({ name: 'RA' })
      const doc = await makeDocument(m.id, { folderId: folder.id })
      const ack = await makeRaAcknowledgment(m.id, doc.id)
      const r = await revokeRaAction(ack.id)
      expect(r).toEqual({ ok: true })
      expect(await prisma.raAcknowledgment.count()).toBe(0)
    })

    it('returns {ok:false,message} — never rejects — for a non-author non-admin', async () => {
      const m = await makeUser({ role: 'member' })
      const other = await makeUser({ role: 'member' })
      mockUser.current = other
      const folder = await makeDocumentFolder({ name: 'RA' })
      const doc = await makeDocument(m.id, { folderId: folder.id })
      const ack = await makeRaAcknowledgment(m.id, doc.id)
      const r = await revokeRaAction(ack.id)
      expect(r).toEqual({ ok: false, message: 'Only the acknowledger or an admin can revoke this record.' })
    })
  })
})

// 404-as-deny (the /api/bookings/[id]/ics posture): the route must not reveal
// whether records exist to anyone who cannot review them. Every response —
// denials included — is private, no-store (the download-route doctrine).
describe('RA acknowledgments Excel export route', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  const sheetOf = async (res: Response) => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as Parameters<ExcelJS.Workbook['xlsx']['load']>[0])
    return wb.getWorksheet('RA acknowledgments')!
  }

  it('an admin downloads every acknowledgment as an attachment workbook', async () => {
    const admin = await makeUser({ role: 'admin' })
    const member = await makeUser({ role: 'member', name: 'Mira' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const doc = await makeDocument(member.id, { folderId: folder.id, name: 'cvd-ra.pdf' })
    await makeRaAcknowledgment(member.id, doc.id, { matricNumber: 'NTU2026ABS', documentName: 'cvd-ra.pdf' })
    signIn(admin)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="labhub-ra-acknowledgments-\d{4}-\d{2}-\d{2}\.xlsx"$/)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const ws = await sheetOf(res)
    // no Organization row (resetDb truncates it) — the Asia/Singapore fallback names the zone
    expect(ws.getRow(1).getCell(5).value).toBe('Acknowledged (Asia/Singapore)')
    expect(ws.getRow(2).getCell(1).value).toBe('Mira')
    expect(ws.getRow(2).getCell(3).value).toBe('NTU2026ABS')

    // A title with quotes and an embedded newline round-trips as ONE literal cell
    // through the real submit action.
    const tricky = await makeDocument(member.id, { folderId: folder.id, name: 'He said "wear gloves", then left\nline-two.pdf' })
    signIn(member)
    expect(await submitRaAction([tricky.id], 'NTU2026ABS')).toEqual({ ok: true, recorded: 1 })
    signIn(admin)
    const ws2 = await sheetOf(await GET())
    expect(ws2.rowCount).toBe(3)
    expect([ws2.getRow(2).getCell(4).value, ws2.getRow(3).getCell(4).value]).toContain('He said "wear gloves", then left\nline-two.pdf')
  })

  it('names the org timezone when an Organization row exists', async () => {
    await prisma.organization.create({ data: { name: 'Lab', timezone: 'Asia/Tokyo' } })
    signIn(await makeUser({ role: 'admin' }))
    expect((await sheetOf(await GET())).getRow(1).getCell(5).value).toBe('Acknowledged (Asia/Tokyo)')
  })

  it('a member and a signed-out caller both get a no-store 404', async () => {
    const member = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const doc = await makeDocument(member.id, { folderId: folder.id })
    await makeRaAcknowledgment(member.id, doc.id, { matricNumber: 'NTU2026ABS' })
    signIn(member)
    const res = await GET()
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    mockUser.current = null
    const anon = await GET()
    expect(anon.status).toBe(404)
    expect(anon.headers.get('cache-control')).toBe('private, no-store')
  })
})
