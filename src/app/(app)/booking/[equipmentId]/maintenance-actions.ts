'use server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/session'
import { createMaintenanceWindow, deleteMaintenanceWindow, type MaintenanceResult } from '@/features/maintenance/service'

export async function createMaintenanceAction(
  equipmentId: string, startsAtISO: string, endsAtISO: string, reason: string, confirmCancel: boolean,
): Promise<MaintenanceResult> {
  const me = await requireUser()
  const r = await createMaintenanceWindow({ equipmentId, startsAt: new Date(startsAtISO), endsAt: new Date(endsAtISO), reason, byId: me.id, confirmCancel })
  revalidatePath(`/booking/${equipmentId}`)
  return r
}

export async function deleteMaintenanceAction(id: string, equipmentId: string): Promise<{ ok: boolean }> {
  const me = await requireUser()
  const r = await deleteMaintenanceWindow(id, me.id)
  revalidatePath(`/booking/${equipmentId}`)
  return r
}
