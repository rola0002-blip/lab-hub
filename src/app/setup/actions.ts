'use server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { saveUpload } from '@/lib/uploads'

// Constant advisory-lock key: every first-run contends on the same lock so the
// Organization row stays a singleton (see the guard in completeSetup below).
const ORG_LOCK_KEY = 'organization-singleton'

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

  // Serialize the org-singleton lookup + create/update behind a transaction-scoped
  // advisory lock (same pattern as src/features/booking/service.ts). Without it two
  // concurrent first-runs both findFirst -> null and both create, yielding two
  // Organization rows and breaking the "One Organization row" invariant (there is no
  // DB uniqueness constraint on the table). Under the lock the loser sees the winner's
  // committed row and updates it. The lock re-checks setupComplete so a first-run that
  // races a just-completed setup still reports "already completed". Released at COMMIT.
  const alreadyComplete = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ORG_LOCK_KEY}, 0))`
    const row = await tx.organization.findFirst()
    if (row?.setupComplete) return true
    if (row) await tx.organization.update({ where: { id: row.id }, data: { name: d.orgName, accentColor: d.accentColor, timezone: d.timezone, logoPath } })
    else await tx.organization.create({ data: { name: d.orgName, accentColor: d.accentColor, timezone: d.timezone, logoPath } })
    return false
  })
  if (alreadyComplete) return { ok: false, message: 'Setup has already been completed.' }

  // better-auth manages its own DB connection and cannot join a Prisma tx, so admin
  // creation stays OUTSIDE the lock. Accepted residual: two concurrent first-runs may
  // each create an admin user — the lock only guarantees the Organization-row singleton.
  try {
    await auth.api.signUpEmail({ body: { email: d.adminEmail, password: d.adminPassword, name: d.adminName } })
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not create admin account.' }
  }
  await prisma.organization.updateMany({ data: { setupComplete: true } })
  return { ok: true }
}
