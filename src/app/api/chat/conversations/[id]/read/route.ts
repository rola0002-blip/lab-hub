import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { markRead } from '@/features/chat/message-service'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  // Member no-op safe: markRead's updateMany matches nothing for non-members.
  await markRead({ userId: user.id, conversationId: id })
  return NextResponse.json({ ok: true })
}
