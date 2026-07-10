import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { listMessages } from '@/features/chat/message-service'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const url = new URL(req.url)
  const r = await listMessages({
    userId: user.id, conversationId: id,
    before: url.searchParams.get('before') ?? undefined,
    take: url.searchParams.get('take') ? Number(url.searchParams.get('take')) : undefined,
  })
  if (!r.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return NextResponse.json({ messages: r.messages, hasMore: r.hasMore, firstUnreadId: r.firstUnreadId })
}
