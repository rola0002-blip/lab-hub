import { prisma } from '@/lib/db'
import { env } from '@/lib/env'
import { buildIcs, type IcsEvent } from '@/features/calendar/ics'

// Public, unauthenticated. Next resolves params.token as "<token>.ics", so strip a
// trailing .ics before lookup (no rewrite needed). Unknown / malformed / revoked
// tokens all return an IDENTICAL generic 404 — no enumeration signal.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const raw = (await params).token
  const token = raw.endsWith('.ics') ? raw.slice(0, -4) : raw
  const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  if (!token) return notFound()

  const user = await prisma.user.findUnique({ where: { icsToken: token }, select: { id: true } })
  if (!user) return notFound()

  const org = await prisma.organization.findFirst()
  const tz = org?.timezone ?? 'Asia/Singapore'
  const cutoff = new Date(Date.now() - 30 * 86_400_000) // 30 days past → all future
  const bookings = await prisma.booking.findMany({
    where: { userId: user.id, status: { in: ['CONFIRMED', 'PENDING'] }, endsAt: { gte: cutoff } },
    include: { equipment: { select: { name: true } } }, orderBy: { startsAt: 'asc' },
  })
  const host = new URL(env.APP_URL).host
  const events: IcsEvent[] = bookings.map((b) => ({
    uid: `${b.id}@${host}`, start: b.startsAt, end: b.endsAt,
    summary: b.equipment.name, description: b.purpose,
    status: b.status === 'CONFIRMED' ? 'CONFIRMED' : 'TENTATIVE',
  }))
  const body = buildIcs({ calName: 'LabHub — My bookings', timezone: tz, events })
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="labhub.ics"',
      // `private`: personal booking data behind a capability URL must never be
      // retained by a shared/intermediary cache (only the end client may cache it).
      'Cache-Control': 'private, max-age=300',
    },
  })
}
