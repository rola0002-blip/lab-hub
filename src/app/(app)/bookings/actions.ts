'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/session'
import { cancelBooking, cancelRecurring, startBookingSession, endBookingSession, setSessionNote } from '@/features/booking/service'

export async function cancelMyBookingAction(bookingId: string, scope: 'one' | 'future'): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser()
  const r = scope === 'future'
    ? await cancelRecurring({ bookingId, byUserId: me.id, scope: 'future' })
    : await cancelBooking({ bookingId, byUserId: me.id })
  revalidatePath('/bookings')
  return r
}

export async function logOnAction(bookingId: string): Promise<{ ok: boolean; message?: string }> {
  const parsed = z.string().min(1).safeParse(bookingId)
  if (!parsed.success) return { ok: false, message: 'Invalid booking.' }
  const me = await requireUser()
  const r = await startBookingSession({ bookingId: parsed.data, byUserId: me.id })
  revalidatePath('/bookings')
  return r
}

export async function logOffAction(bookingId: string, note: string | null): Promise<{ ok: boolean; message?: string }> {
  const parsed = z.object({ bookingId: z.string().min(1), note: z.string().trim().max(1000, 'Session notes are limited to 1000 characters.').nullable() }).safeParse({ bookingId, note })
  if (!parsed.success) return { ok: false, message: 'Invalid session note.' }
  const me = await requireUser()
  const r = await endBookingSession({ bookingId: parsed.data.bookingId, byUserId: me.id, note: parsed.data.note ?? undefined })
  revalidatePath('/bookings')
  return r
}

export async function saveSessionNoteAction(bookingId: string, note: string): Promise<{ ok: boolean; message?: string }> {
  const parsed = z.object({ bookingId: z.string().min(1), note: z.string().trim().max(1000, 'Session notes are limited to 1000 characters.') }).safeParse({ bookingId, note })
  if (!parsed.success) return { ok: false, message: 'Invalid session note.' }
  const me = await requireUser()
  const r = await setSessionNote({ bookingId: parsed.data.bookingId, byUserId: me.id, note: parsed.data.note })
  revalidatePath('/bookings')
  return r
}
