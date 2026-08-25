import { getSessionUser } from '@/lib/session'
import { canReviewRa } from '@/features/ra/ra-policy'
import { listAllRaAcknowledgments } from '@/features/ra/ra-service'

// Admin-only CSV export (the /api/bookings/[id]/ics posture: session-gated,
// 404-as-deny so the existence of records never leaks to non-admins).
const cell = (v: string) => `"${v.replace(/"/g, '""')}"`

export async function GET() {
  const user = await getSessionUser()
  if (!user || !canReviewRa(user.role)) return new Response('Not found', { status: 404 })
  const rows = await listAllRaAcknowledgments(user)
  const lines = [
    [cell('name'), cell('email'), cell('matric'), cell('ra'), cell('acknowledgedAt')].join(','),
    ...rows.map((r) => [cell(r.author.name), cell(r.author.email), cell(r.matricNumber), cell(r.documentName), cell(r.createdAt)].join(',')),
  ]
  return new Response(lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ra-acknowledgments.csv"',
    },
  })
}
