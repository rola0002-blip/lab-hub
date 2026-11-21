import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { markNotificationsRead, markNotificationsReadUpTo } from '@/lib/notification-read'

// Wave 22: `upTo` is the tray's path (read everything up to the newest loaded row);
// `ids` stays for tabs loaded before the deploy.
const Body = z.union([
  z.object({ upTo: z.string().datetime() }),
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
