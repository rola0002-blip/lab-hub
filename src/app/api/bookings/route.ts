import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { createBooking, createRecurringBooking, listBookings } from '@/features/booking/service'
import { bookingBody } from '@/features/booking/schema'

const query = z.object({
  equipmentId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  mine: z.enum(['1', 'true', '0', 'false']).optional(),
})

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const p = new URL(req.url).searchParams
  const parsed = query.safeParse({
    equipmentId: p.get('equipmentId') ?? undefined,
    from: p.get('from') ?? undefined,
    to: p.get('to') ?? undefined,
    mine: p.get('mine') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const d = parsed.data
  const from = d.from ?? new Date()
  const to = d.to ?? new Date(from.getTime() + 7 * 24 * 3_600_000)
  if (from.getTime() >= to.getTime()) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const bookings = await listBookings({
    equipmentId: d.equipmentId,
    userId: d.mine === '1' || d.mine === 'true' ? user.id : undefined,
    from, to,
  })
  return NextResponse.json({
    bookings: bookings.map((b) => ({ ...b, startsAt: b.startsAt.toISOString(), endsAt: b.endsAt.toISOString() })),
  })
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = bookingBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const b = parsed.data

  if (b.recurring) {
    const r = await createRecurringBooking({ userId: user.id, equipmentId: b.equipmentId, purpose: b.purpose, ...b.recurring })
    if (r.ok) return NextResponse.json({ ok: true, pending: r.pending, count: r.count }, { status: 201 })
    if (r.error === 'conflicts') return NextResponse.json({ error: 'conflicts', conflicts: r.conflicts }, { status: 409 })
    if (r.error === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 })
    return NextResponse.json({ error: 'blocked', message: r.message }, { status: 422 })
  }

  const r = await createBooking({ userId: user.id, equipmentId: b.equipmentId, startsAt: b.startsAt, endsAt: b.endsAt, purpose: b.purpose })
  if (r.ok) return NextResponse.json({ ok: true, pending: r.pending, bookingId: r.bookingId }, { status: 201 })
  if (r.error === 'slot_taken') return NextResponse.json({ error: 'slot_taken', message: 'That time was just taken. Pick another slot.' }, { status: 409 })
  if (r.error === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ error: 'blocked', message: r.message }, { status: 422 })
}
