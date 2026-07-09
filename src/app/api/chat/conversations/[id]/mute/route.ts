import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { isMember, setMuted } from '@/features/chat/conversation-service'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({ muted: z.boolean() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { id } = await params
  if (!(await isMember(user.id, id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  await setMuted({ conversationId: id, userId: user.id, muted: parsed.data.muted })
  return NextResponse.json({ ok: true })
}
