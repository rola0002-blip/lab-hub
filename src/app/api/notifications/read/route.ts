import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { markNotificationsRead, markNotificationsReadUpTo } from '@/lib/notification-read'

// Wave 22: `upTo` is the tray's path (read everything up to the newest loaded row);
// `ids` stays for tabs loaded before the deploy. zod accepts ISO year 0000, which
// Postgres rejects ("date/time field value out of range") — no bell row predates
// 1970, so anything at or before the epoch is a 400 here, never a 500 there.
const Body = z.union([
  z.object({ upTo: z.string().datetime().refine((s) => Date.parse(s) > 0) }),
  z.object({ ids: z.array(z.string()).max(100) }),
])

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = Body.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  if ('upTo' in body.data) await markNotificationsReadUpTo(user.id, new Date(body.data.upTo))
  else await markNotificationsRead(user.id, body.data.ids)
  return NextResponse.json({ ok: true })
}
