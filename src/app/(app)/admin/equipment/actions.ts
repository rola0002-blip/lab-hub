'use server'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/session'
import { saveUpload } from '@/lib/uploads'
import { createEquipment, updateEquipment, setManagers, retireEquipment, equipmentSchema } from '@/features/equipment/service'

function parseForm(fd: FormData) {
  return equipmentSchema.omit({ photoPath: true }).parse({
    name: fd.get('name'), description: fd.get('description') ?? '', location: fd.get('location') ?? '',
    advanceBookingDays: fd.get('advanceBookingDays'), maxDurationMinutes: fd.get('maxDurationMinutes'),
    certificationRequired: fd.get('certificationRequired') === 'on',
    approvalPolicy: fd.get('approvalPolicy'), allowRecurring: fd.get('allowRecurring') === 'on',
  })
}

async function photoPathFrom(fd: FormData): Promise<string | undefined> {
  const f = fd.get('photo') as File | null
  if (!f || f.size === 0) return undefined
  return saveUpload(f, 'equipment')
}

export async function createEquipmentAction(fd: FormData): Promise<{ ok: boolean; message?: string }> {
  await requireAdmin()
  try {
    const eq = await createEquipment({ ...parseForm(fd), photoPath: (await photoPathFrom(fd)) ?? null })
    await setManagers(eq.id, fd.getAll('managers').map(String))
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Invalid input' }
  }
  revalidatePath('/admin/equipment'); revalidatePath('/booking')
  return { ok: true }
}

export async function updateEquipmentAction(id: string, fd: FormData): Promise<{ ok: boolean; message?: string }> {
  await requireAdmin()
  try {
    const photoPath = await photoPathFrom(fd)
    await updateEquipment(id, { ...parseForm(fd), ...(photoPath ? { photoPath } : {}) })
    await setManagers(id, fd.getAll('managers').map(String))
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Invalid input' }
  }
  revalidatePath('/admin/equipment'); revalidatePath('/booking')
  return { ok: true }
}

export async function retireEquipmentAction(id: string): Promise<{ cancelled: number }> {
  await requireAdmin()
  const r = await retireEquipment(id)
  revalidatePath('/admin/equipment'); revalidatePath('/booking')
  return r
}
