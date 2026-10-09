import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { loadNavCounts } from '@/lib/nav-counts'

// W20-D: the session user's live sidebar badge counts (the /api/notifications
// posture: session-gated, 401 JSON; extensionless API paths are never edge-cached).
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json(await loadNavCounts(user))
}
