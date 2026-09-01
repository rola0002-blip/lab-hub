import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { noteActivity } from '@/lib/activity'

// Activity heartbeat for the push-idle gate (2026-09 notifications design).
// Clients POST at most once per minute (see use-activity.ts); the handler is
// O(1) so no server-side rate limit is needed beyond auth.
export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  noteActivity(user.id)
  return new NextResponse(null, { status: 204 })
}
