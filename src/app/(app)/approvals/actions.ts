'use server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { decideBooking, decideRecurring } from '@/features/booking/service'

export async function approveAction(bookingId: string): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser()
  const r = await decideBooking({ bookingId, deciderId: me.id, decision: 'approve' })
  revalidatePath('/approvals')
  return r
}

export async function rejectAction(bookingId: string, reason: string): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser()
  const r = await decideBooking({ bookingId, deciderId: me.id, decision: 'reject', reason })
  revalidatePath('/approvals')
  return r
}

export async function approveRuleAction(ruleId: string): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser()
  const r = await decideRecurring({ ruleId, deciderId: me.id, decision: 'approve' })
  revalidatePath('/approvals')
  return r
}

export async function rejectRuleAction(ruleId: string, reason: string): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser()
  const r = await decideRecurring({ ruleId, deciderId: me.id, decision: 'reject', reason })
  revalidatePath('/approvals')
  return r
}
