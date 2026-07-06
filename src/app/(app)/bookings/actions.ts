'use server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { cancelBooking, cancelRecurring } from '@/features/booking/service'

export async function cancelMyBookingAction(bookingId: string, scope: 'one' | 'future'): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser()
  const r = scope === 'future'
    ? await cancelRecurring({ bookingId, byUserId: me.id, scope: 'future' })
    : await cancelBooking({ bookingId, byUserId: me.id })
  revalidatePath('/bookings')
  return r
}
