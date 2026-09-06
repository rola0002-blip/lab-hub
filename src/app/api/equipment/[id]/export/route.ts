import { getSessionUser } from '@/lib/session'
import { isManagerOf } from '@/features/equipment/service'
import { buildEquipmentRecordsXlsx } from '@/features/equipment/export-service'

// Session-authenticated per-equipment records download (.xlsx, 3 sheets). Authz:
// equipment manager or admin (isManagerOf returns true for admins) — the
// /api/bookings/[id]/ics posture. Everyone else → 404, and a missing equipment
// → 404, so neither the equipment's existence nor its records leak.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return new Response('Not found', { status: 404 })
  const { id } = await params
  if (!(await isManagerOf(user.id, id))) return new Response('Not found', { status: 404 })
  const exported = await buildEquipmentRecordsXlsx(id)
  if (!exported) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(exported.body), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${exported.filename}"`,
    },
  })
}
