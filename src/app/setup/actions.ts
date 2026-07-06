'use server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { saveUpload } from '@/lib/uploads'

const schema = z.object({
  orgName: z.string().min(1).max(100),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  timezone: z.string().min(1),
  adminName: z.string().min(1).max(100),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(10),
})

export async function completeSetup(input: {
  orgName: string; accentColor: string; timezone: string
  adminName: string; adminEmail: string; adminPassword: string
  logo?: File | null
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const existing = await prisma.organization.findFirst()
  if (existing?.setupComplete) return { ok: false, message: 'Setup has already been completed.' }
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message }
  const d = parsed.data

  let logoPath: string | undefined
  if (input.logo && input.logo.size > 0) {
    try { logoPath = await saveUpload(input.logo, 'logo') }
    catch { return { ok: false, message: 'Logo must be PNG/JPEG/WebP under 2 MB.' } }
  }

  if (existing) await prisma.organization.update({ where: { id: existing.id }, data: { name: d.orgName, accentColor: d.accentColor, timezone: d.timezone, logoPath } })
  else await prisma.organization.create({ data: { name: d.orgName, accentColor: d.accentColor, timezone: d.timezone, logoPath } })

  try {
    await auth.api.signUpEmail({ body: { email: d.adminEmail, password: d.adminPassword, name: d.adminName } })
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not create admin account.' }
  }
  await prisma.organization.updateMany({ data: { setupComplete: true } })
  return { ok: true }
}
