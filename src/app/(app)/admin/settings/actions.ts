'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/session'
import { saveUpload } from '@/lib/uploads'

export async function updateOrgAction(fd: FormData): Promise<{ ok: boolean; message?: string }> {
  await requireAdmin()
  const parsed = z.object({
    name: z.string().min(1).max(100),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    timezone: z.string().min(1),
  }).safeParse({ name: fd.get('name'), accentColor: fd.get('accentColor'), timezone: fd.get('timezone') })
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message }
  let logoPath: string | undefined
  const logo = fd.get('logo') as File | null
  if (logo && logo.size > 0) {
    try { logoPath = await saveUpload(logo, 'logo') } catch { return { ok: false, message: 'Logo must be PNG/JPEG/WebP under 2 MB.' } }
  }
  await prisma.organization.updateMany({ data: { ...parsed.data, ...(logoPath ? { logoPath } : {}) } })
  revalidatePath('/', 'layout')
  return { ok: true }
}
