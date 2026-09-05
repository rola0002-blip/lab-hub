'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/session'
import { grantCertification, revokeCertification } from '@/features/certifications/service'
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

export async function revokeCertAction(userId: string, equipmentId: string): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser()
  try {
    await revokeCertification({ userId, equipmentId, byId: me.id })
  } catch (e) {
    if (e instanceof PolicyError) return { ok: false, message: e.message }
    return { ok: false, message: 'Could not save — check your connection and try again.' }
  }
  revalidatePath('/certifications')
  return { ok: true }
}
