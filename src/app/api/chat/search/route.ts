import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { searchMessages } from '@/features/chat/search-service'

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const hits = await searchMessages({
    userId: user.id,
    query: url.searchParams.get('q') ?? '',
    conversationId: url.searchParams.get('cid') ?? undefined,
  })
  return NextResponse.json({ hits })
}
