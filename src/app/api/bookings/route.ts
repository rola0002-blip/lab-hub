import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { createBooking, createRecurringBooking } from '@/features/booking/service'
import { bookingBody } from '@/features/booking/schema'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = bookingBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const b = parsed.data

  if (b.recurring) {
    const r = await createRecurringBooking({ userId: user.id, equipmentId: b.equipmentId, purpose: b.purpose, ...b.recurring })
    if (r.ok) return NextResponse.json({ ok: true, pending: true, count: r.count }, { status: 201 })
    if (r.error === 'conflicts') return NextResponse.json({ error: 'conflicts', conflicts: r.conflicts }, { status: 409 })
    if (r.error === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ error: 'blocked', message: r.message }, { status: 422 })
  }

  const r = await createBooking({ userId: user.id, equipmentId: b.equipmentId, startsAt: b.startsAt, endsAt: b.endsAt, purpose: b.purpose })
  if (r.ok) return NextResponse.json({ ok: true, pending: r.pending }, { status: 201 })
  if (r.error === 'slot_taken') return NextResponse.json({ error: 'slot_taken', message: 'That time was just taken. Pick another slot.' }, { status: 409 })
  if (r.error === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ error: 'blocked', message: r.message }, { status: 422 })
}
