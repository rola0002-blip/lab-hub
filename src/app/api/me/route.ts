import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { setThemePreference, setAccentPreference } from '@/features/settings/service'
import { isAccentSlug } from '@/lib/accents'

const bodySchema = z.object({
  themePreference: z.enum(['light', 'dark']).optional(),
  accentPreference: z.string().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'empty' })

export async function PATCH(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { themePreference, accentPreference } = parsed.data
  if (accentPreference !== undefined && !isAccentSlug(accentPreference)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (themePreference !== undefined) await setThemePreference(user.id, themePreference)
  if (accentPreference !== undefined) await setAccentPreference(user.id, accentPreference)
  return NextResponse.json({ ok: true })
}
