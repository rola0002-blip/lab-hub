'use server'
import { requireUser } from '@/lib/session'
import { regenerateIcsToken } from '@/features/calendar/token-service'

export async function regenerateIcsTokenAction(): Promise<{ ok: true; token: string } | { ok: false }> {
  const u = await requireUser()
  try {
    return { ok: true, token: await regenerateIcsToken(u.id) }
  } catch {
    return { ok: false }
  }
}
