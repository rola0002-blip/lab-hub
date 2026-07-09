import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { getOrCreateDm } from '@/features/chat/conversation-service'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({ userIds: z.array(z.string()).min(1).max(8) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const r = await getOrCreateDm({ userIds: [...new Set([...parsed.data.userIds, user.id])], byId: user.id })
  return r.ok ? NextResponse.json({ conversationId: r.conversationId }) : NextResponse.json({ message: r.message }, { status: 422 })
}
