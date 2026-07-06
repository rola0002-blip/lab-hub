import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { previewBooking } from '@/features/booking/service'
import { bookingBody } from '@/features/booking/schema'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = bookingBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const b = parsed.data
  const verdict = await previewBooking({ userId: user.id, equipmentId: b.equipmentId, startsAt: b.startsAt, endsAt: b.endsAt, recurring: !!b.recurring })
  return NextResponse.json(verdict)
}
