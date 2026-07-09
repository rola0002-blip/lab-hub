import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { onlineUserIds } from '@/lib/events'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ online: onlineUserIds() })
}
