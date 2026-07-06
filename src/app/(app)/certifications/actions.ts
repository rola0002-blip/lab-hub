'use server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { grantCertification, revokeCertification } from '@/features/certifications/service'

export async function toggleCertAction(userId: string, equipmentId: string, grant: boolean): Promise<{ ok: boolean; message?: string }> {
  const me = await requireUser()
  try {
    if (grant) await grantCertification({ userId, equipmentId, grantedById: me.id })
    else await revokeCertification({ userId, equipmentId, byId: me.id })
  } catch {
    return { ok: false, message: 'You can only manage certifications for instruments you manage.' }
  }
  revalidatePath('/certifications')
  return { ok: true }
}
