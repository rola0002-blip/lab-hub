'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { requireUser } from '@/lib/session'
import { grantCertification, revokeCertification, revokeTrainingRecord } from '@/features/certifications/service'
import { createTrainingRequest, decideTrainingRequest } from '@/features/certifications/training-request-service'
import { PolicyError } from '@/features/certifications/policy'

// W12-B: a Server Action is an RPC endpoint — zod-guard the wire args so a forged
// non-string degrades to {ok:false,message}, never a PrismaClientValidationError 500
// (the v0.15 lessons; milestone actions idiom). The service still owns permission,
// the future-date rule, and the not-found translation.
const grantSchema = z.object({
  userId: z.string().min(1),
  equipmentId: z.string().min(1),
  trainedById: z.string().min(1),
  trainedOn: z.string().date('Training date must be a valid date.'),
  note: z.string().max(500, 'Notes are limited to 500 characters.').default(''),
})

// W14-A: revocation requires a reason — the shared field guard for both revoke
// actions (the grantSchema wire-guard idiom; also closes the gap where the old
// revokeCertAction had no zod guard at all).
const revokeReason = z.string().trim().min(1, 'Provide a revocation reason.').max(500, 'Reasons are limited to 500 characters.')
const revokeCertSchema = z.object({ userId: z.string().min(1), equipmentId: z.string().min(1), reason: revokeReason })
const revokeRecordSchema = z.object({ recordId: z.string().min(1), reason: revokeReason })

export async function grantCertAction(
  userId: string, equipmentId: string, trainedById: string, trainedOn: string, note: string,
): Promise<{ ok: boolean; message?: string }> {
  const parsed = grantSchema.safeParse({ userId, equipmentId, trainedById, trainedOn, note })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid training record.' }
  const me = await requireUser()
  try {
    await grantCertification({
      userId: parsed.data.userId, equipmentId: parsed.data.equipmentId, grantedById: me.id,
      trainedById: parsed.data.trainedById, trainedOn: parsed.data.trainedOn, note: parsed.data.note,
    })
  } catch (e) {
    if (e instanceof PolicyError) return { ok: false, message: e.message }
    return { ok: false, message: 'Could not save — check your connection and try again.' }
  }
  revalidatePath('/certifications')
  return { ok: true }
}

export async function revokeCertAction(userId: string, equipmentId: string, reason: string): Promise<{ ok: boolean; message?: string }> {
  const parsed = revokeCertSchema.safeParse({ userId, equipmentId, reason })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid revocation.' }
  const me = await requireUser()
  try {
    await revokeCertification({ userId: parsed.data.userId, equipmentId: parsed.data.equipmentId, byId: me.id, reason: parsed.data.reason })
  } catch (e) {
    if (e instanceof PolicyError) return { ok: false, message: e.message }
    return { ok: false, message: 'Could not save — check your connection and try again.' }
  }
  revalidatePath('/certifications')
  return { ok: true }
}

export async function revokeTrainingRecordAction(recordId: string, reason: string): Promise<{ ok: boolean; message?: string }> {
  const parsed = revokeRecordSchema.safeParse({ recordId, reason })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid revocation.' }
  const me = await requireUser()
  try {
    await revokeTrainingRecord({ recordId: parsed.data.recordId, byId: me.id, reason: parsed.data.reason })
  } catch (e) {
    if (e instanceof PolicyError) return { ok: false, message: e.message }
    return { ok: false, message: 'Could not save — check your connection and try again.' }
  }
  revalidatePath('/certifications')
  return { ok: true }
}

// v0.32 Task 7: training requests (the Task 6 service, thin-wrapped). Wire guards
// follow grantSchema; the service still owns permission and dedupe. P2002 is the
// partial unique index on PENDING (userId, equipmentId) firing on the check-then-
// insert race — the same message the service's own pre-check returns.
const requestSchema = z.object({
  equipmentId: z.string().min(1),
  note: z.string().max(500, 'Notes are limited to 500 characters.').default(''),
})
const decideSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['grant', 'decline']),
  reason: z.string().max(500, 'Reasons are limited to 500 characters.').optional(),
  trainedOn: z.string().date('Training date must be a valid date.').optional(),
})

export async function createTrainingRequestAction(equipmentId: string, note: string): Promise<{ ok: boolean; message?: string }> {
  const parsed = requestSchema.safeParse({ equipmentId, note })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid training request.' }
  const me = await requireUser()
  let r: { ok: boolean; message?: string }
  try {
    r = await createTrainingRequest({ userId: me.id, equipmentId: parsed.data.equipmentId, note: parsed.data.note })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      r = { ok: false, message: 'You already have an open training request for this instrument.' }
    } else {
      return { ok: false, message: 'Could not send — check your connection and try again.' }
    }
  }
  if (r.ok) {
    revalidatePath('/certifications')
    revalidatePath(`/booking/${parsed.data.equipmentId}`)
    revalidatePath('/booking')
  }
  return r
}

export async function decideTrainingRequestAction(
  requestId: string, decision: 'grant' | 'decline', reason?: string, trainedOn?: string,
): Promise<{ ok: boolean; message?: string }> {
  const parsed = decideSchema.safeParse({ requestId, decision, reason, trainedOn })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid decision.' }
  const me = await requireUser()
  let r: { ok: boolean; message?: string }
  try {
    r = await decideTrainingRequest({
      requestId: parsed.data.requestId, byId: me.id, decision: parsed.data.decision,
      reason: parsed.data.reason, trainedOn: parsed.data.trainedOn,
    })
  } catch {
    return { ok: false, message: 'Could not save — check your connection and try again.' }
  }
  if (r.ok) {
    revalidatePath('/certifications')
    // The decision changes this instrument's surfaces for both parties; the
    // equipment page route is dynamic-segmented, so bust every instance of it.
    revalidatePath('/booking/[equipmentId]', 'page')
    revalidatePath('/booking')
  }
  return r
}
