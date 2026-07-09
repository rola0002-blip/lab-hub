import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { pushEnabled } from '@/lib/push'
import { getSessionUser } from '@/lib/session'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ publicKey: pushEnabled() ? env.VAPID_PUBLIC_KEY : null })
}
