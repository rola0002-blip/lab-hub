import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { cancelBooking } from '@/features/booking/service'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const r = await cancelBooking({ bookingId: id, byUserId: user.id })
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message }, { status: 403 })
}
