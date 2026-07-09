import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { editMessage, deleteMessage, getMessageDto } from '@/features/chat/message-service'
import { isMember } from '@/features/chat/conversation-service'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const message = await getMessageDto(id)
  if (!message || !(await isMember(user.id, message.conversationId))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ message })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({ body: z.string().min(1).max(4000) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { id } = await params
  const r = await editMessage({ messageId: id, userId: user.id, body: parsed.data.body })
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message }, { status: 403 })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const r = await deleteMessage({ messageId: id, userId: user.id })
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message }, { status: 403 })
}
