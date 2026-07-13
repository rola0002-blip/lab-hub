import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment } from '../factories'
import { ensureIcsToken, regenerateIcsToken } from '@/features/calendar/token-service'
import { GET } from '@/app/api/calendar/[token]/route'

const call = (token: string) => GET(new Request('http://localhost/api/calendar/x'), { params: Promise.resolve({ token }) })

describe('calendar feed route', () => {
  beforeEach(resetDb)

  it('serves the user bookings with correct STATUS mapping and window', async () => {
    const u = await makeUser()
    const eq = await makeEquipment({ name: 'CVD furnace' })
    const now = Date.now()
    const conf = await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, status: 'CONFIRMED', purpose: 'run', startsAt: new Date(now + 3_600_000), endsAt: new Date(now + 7_200_000) } })
    const pend = await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, status: 'PENDING', purpose: 'req', startsAt: new Date(now + 10_800_000), endsAt: new Date(now + 14_400_000) } })
    // Outside the window (ended 40 days ago) and a cancelled row → absent.
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, status: 'CONFIRMED', purpose: 'old', startsAt: new Date(now - 41 * 86_400_000), endsAt: new Date(now - 40 * 86_400_000) } })
    await prisma.booking.create({ data: { userId: u.id, equipmentId: eq.id, status: 'CANCELLED', purpose: 'x', startsAt: new Date(now + 3_600_000), endsAt: new Date(now + 7_200_000) } })

    const token = await ensureIcsToken(u.id)
    const res = await call(`${token}.ics`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    const text = await res.text()
    expect(text).toContain(`UID:${conf.id}@`)
    expect(text).toContain(`UID:${pend.id}@`)
    expect((text.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2) // old + cancelled excluded
    expect(text).toContain('STATUS:CONFIRMED')
    expect(text).toContain('STATUS:TENTATIVE')
  })

  it('returns a generic 404 for unknown, malformed and revoked tokens', async () => {
    expect((await call('unknown.ics')).status).toBe(404)
    expect((await call('.ics')).status).toBe(404)
    const u = await makeUser()
    const t1 = await ensureIcsToken(u.id)
    expect((await call(`${t1}.ics`)).status).toBe(200)
    const t2 = await regenerateIcsToken(u.id) // rotate → old 404s, new works
    expect((await call(`${t1}.ics`)).status).toBe(404)
    expect((await call(`${t2}.ics`)).status).toBe(200)
  })

  it('ensureIcsToken is idempotent', async () => {
    const u = await makeUser()
    expect(await ensureIcsToken(u.id)).toBe(await ensureIcsToken(u.id))
  })

  // Note: requireUser reads the session; this test checks regenerateIcsToken
  // directly (the action is a thin session wrapper). The feed-route test above already
  // proves rotation end-to-end (old 404s, new works).
  it('regenerateIcsToken rotates the stored token', async () => {
    const u = await makeUser()
    const a = await ensureIcsToken(u.id)
    const b = await regenerateIcsToken(u.id)
    expect(b).not.toBe(a)
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { icsToken: true } })
    expect(row.icsToken).toBe(b)
  })
})
