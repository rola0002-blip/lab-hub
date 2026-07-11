import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import {
  setThemePreference, setAccentPreference, setName, setTitle, setTimezone,
} from '@/features/settings/service'
import { isAccentSlug } from '@/lib/accents'
import { isValidDisplayName, isValidTitle, isSupportedTimezone } from '@/lib/profile'

const bodySchema = z.object({
  themePreference: z.enum(['light', 'dark']).optional(),
  accentPreference: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  timezone: z.string().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: 'empty' })

const bad = () => NextResponse.json({ error: 'bad_request' }, { status: 400 })

export async function PATCH(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return bad()
  const { themePreference, accentPreference, name, title, timezone } = parsed.data
  if (accentPreference !== undefined && !isAccentSlug(accentPreference)) return bad()
  if (name !== undefined && !isValidDisplayName(name)) return bad()
  if (title !== undefined && !isValidTitle(title)) return bad()
  // An empty timezone is the "Not set" option in the profile <select> and means
  // "clear it" (setTimezone stores null); only a non-empty unknown zone is a 400.
  if (timezone !== undefined && timezone !== '' && !isSupportedTimezone(timezone)) return bad()
  if (themePreference !== undefined) await setThemePreference(user.id, themePreference)
  if (accentPreference !== undefined) await setAccentPreference(user.id, accentPreference)
  if (name !== undefined) await setName(user.id, name)
  if (title !== undefined) await setTitle(user.id, title)
  if (timezone !== undefined) await setTimezone(user.id, timezone)
  return NextResponse.json({ ok: true })
}
