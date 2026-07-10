import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { setThemePreference } from '@/features/settings/service'

const bodySchema = z.object({ themePreference: z.enum(['light', 'dark']) })

export async function PATCH(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  await setThemePreference(user.id, parsed.data.themePreference)
  return NextResponse.json({ ok: true })
}
