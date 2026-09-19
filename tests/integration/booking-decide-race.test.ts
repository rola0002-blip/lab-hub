import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { resetDb, makeUser, makeEquipment, hoursFromNow } from '../factories'
import { decideBooking } from '@/features/booking/service'
import { expirePendingBookings } from '@/lib/jobs'

beforeEach(() => resetDb())
afterEach(() => vi.restoreAllMocks())

// Schema-aligned seed: users carry no password column (better-auth), equipment
// takes the factory defaults, and role 'admin' satisfies isManagerOf.
async function seed() {
  const user = await makeUser()
  const manager = await makeUser({ role: 'admin' })
  const eq = await makeEquipment({ approvalPolicy: 'ALL' })
  const booking = await prisma.booking.create({
    data: {
      userId: user.id, equipmentId: eq.id,
      startsAt: hoursFromNow(1), endsAt: hoursFromNow(2),
      purpose: 'p', status: 'PENDING',
    },
  })
  return { user, manager, eq, booking }
}

describe('decideBooking race guard', () => {
  it('does not resurrect a CANCELLED booking', async () => {
    const { user, manager, booking } = await seed()
    // Owner cancels between the manager's read and write. A plain update before
    // the call cannot hit that window (the read itself would see CANCELLED), so
    // interpose on the read: the flip lands after decideBooking has seen
    // PENDING but before its write — exactly the TOCTOU being guarded.
    const read = prisma.booking.findUnique.bind(prisma.booking)
    vi.spyOn(prisma.booking, 'findUnique').mockImplementation(
      (async (args: Prisma.BookingFindUniqueArgs) => {
        const b = await read(args)
        if (b && b.id === booking.id) {
          await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } })
        }
        return b
      }) as unknown as typeof prisma.booking.findUnique,
    )
    const r = await decideBooking({ bookingId: booking.id, deciderId: manager.id, decision: 'approve' })
    expect(r.ok).toBe(false)
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(after.status).toBe('CANCELLED')
    // The decision (and its notifications) must only land when the guarded
    // update actually claimed the row.
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0)
  })
})

describe('expirePendingBookings sweep guard', () => {
  it('never flips a booking that stopped being PENDING', async () => {
    const { booking } = await seed()
    await prisma.booking.update({ where: { id: booking.id }, data: { startsAt: new Date(Date.now() - 60_000) } })
    // Approved mid-sweep: interpose on the sweep's findMany so the CONFIRMED
    // write lands after the overdue snapshot was taken — the read-to-write
    // window the bulk flip used to stomp.
    const read = prisma.booking.findMany.bind(prisma.booking)
    vi.spyOn(prisma.booking, 'findMany').mockImplementation(
      (async (args: Prisma.BookingFindManyArgs) => {
        const rows = (await read(args)) as Array<{ id: string }>
        if (rows.some((row) => row.id === booking.id)) {
          await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } }) // approved mid-sweep
        }
        return rows
      }) as unknown as typeof prisma.booking.findMany,
    )
    const n = await expirePendingBookings(new Date())
    expect(n).toBe(0)
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })
    expect(after.status).toBe('CONFIRMED')
    // Expiry notifications only fire for rows the sweep actually flipped.
    expect(await prisma.notification.count({ where: { type: 'booking_expired' } })).toBe(0)
  })
})
