import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
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

import { submitRaAction } from '@/app/(app)/ra/actions'
import { GET } from '@/app/api/ra/acknowledgments/csv/route'

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
    expect(await submitRaAction(doc.id, 'NTU2026ABS')).toEqual({ ok: true })
    const row = await prisma.raAcknowledgment.findFirstOrThrow({ where: { userId: member.id, documentId: doc.id } })
    expect(row.matricNumber).toBe('NTU2026ABS')
    expect(row.documentName).toBe('cvd-ra.pdf') // snapshotted, not joined
  })

  it('submitRaAction: a document outside the RA folder is refused with the pick-from-list message', async () => {
    const member = await makeUser({ role: 'member' })
    await makeDocumentFolder({ name: 'RA' })
    const other = await makeDocumentFolder()
    const foreign = await makeDocument(member.id, { folderId: other.id })
    signIn(member)
    expect(await submitRaAction(foreign.id, 'A1')).toEqual({ ok: false, message: 'Pick an RA document from the list.' })
    expect(await prisma.raAcknowledgment.count()).toBe(0)
  })

  it('submitRaAction: a forged non-string id degrades to a result, never a rejected promise', async () => {
    const member = await makeUser({ role: 'member' })
    await makeDocumentFolder({ name: 'RA' })
    signIn(member)
    expect(await submitRaAction(42 as never, 'A1')).toEqual({ ok: false, message: 'Invalid acknowledgment.' })
    expect(await prisma.raAcknowledgment.count()).toBe(0)
  })
})

// 404-as-deny (the /api/bookings/[id]/ics posture): the route must not reveal
// whether records exist to anyone who cannot review them.
describe('RA acknowledgments CSV route', () => {
  beforeEach(async () => { await resetDb(); mockUser.current = null })

  it('an admin exports every acknowledgment as an attachment CSV', async () => {
    const admin = await makeUser({ role: 'admin' })
    const member = await makeUser({ role: 'member', name: 'Mira' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const doc = await makeDocument(member.id, { folderId: folder.id, name: 'cvd-ra.pdf' })
    await makeRaAcknowledgment(member.id, doc.id, { matricNumber: 'NTU2026ABS', documentName: 'cvd-ra.pdf' })
    signIn(admin)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const body = await res.text()
    // cell() quotes every field, so the header line is the quoted form.
    expect(body).toContain('"name","email","matric","ra","acknowledgedAt"')
    expect(body).toContain('NTU2026ABS')
  })

  it('a member and a signed-out caller both get 404', async () => {
    const member = await makeUser({ role: 'member' })
    const folder = await makeDocumentFolder({ name: 'RA' })
    const doc = await makeDocument(member.id, { folderId: folder.id })
    await makeRaAcknowledgment(member.id, doc.id, { matricNumber: 'NTU2026ABS' })
    signIn(member)
    expect((await GET()).status).toBe(404)
    mockUser.current = null
    expect((await GET()).status).toBe(404)
  })
})
