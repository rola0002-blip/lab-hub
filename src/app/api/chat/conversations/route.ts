import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { listConversations, createChannel } from '@/features/chat/conversation-service'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ conversations: await listConversations(user.id) })
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({ name: z.string().min(1).max(60), topic: z.string().max(200).optional(), isPrivate: z.boolean().default(false) })
    .safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const r = await createChannel({ ...parsed.data, createdById: user.id })
  return r.ok
    ? NextResponse.json({ conversationId: r.conversationId }, { status: 201 })
    : NextResponse.json({ message: r.message }, { status: 422 })
}
