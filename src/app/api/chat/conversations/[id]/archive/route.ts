import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { archiveChannel } from '@/features/chat/conversation-service'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const r = await archiveChannel({ conversationId: id, byId: user.id })
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message }, { status: 403 })
}
