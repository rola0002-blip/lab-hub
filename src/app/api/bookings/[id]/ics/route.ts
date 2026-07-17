import { getSessionUser } from '@/lib/session'
import { prisma } from '@/lib/db'
import { env } from '@/lib/env'
import { isManagerOf } from '@/features/equipment/service'
import { buildIcs } from '@/features/calendar/ics'

// Session-authenticated single-event download. Authz: owner, equipment manager, or
// admin (isManagerOf already returns true for admins). Everyone else → 404 (no leak).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return new Response('Not found', { status: 404 })
  const { id } = await params
  const b = await prisma.booking.findUnique({ where: { id }, include: { equipment: { select: { name: true } } } })
  if (!b) return new Response('Not found', { status: 404 })
  const allowed = b.userId === user.id || (await isManagerOf(user.id, b.equipmentId))
  if (!allowed) return new Response('Not found', { status: 404 })

  const org = await prisma.organization.findFirst()
  const host = new URL(env.APP_URL).host
  const body = buildIcs({
    calName: 'LabHub — Booking', timezone: org?.timezone ?? 'Asia/Singapore',
    events: [{
      uid: `${b.id}@${host}`, start: b.startsAt, end: b.endsAt,
      summary: b.equipment.name, description: b.purpose,
      status: b.status === 'CONFIRMED' ? 'CONFIRMED' : 'TENTATIVE',
    }],
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="booking-${b.id}.ics"` },
  })
}
