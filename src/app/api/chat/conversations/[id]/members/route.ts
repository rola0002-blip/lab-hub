import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/session'
import { notify } from '@/lib/notify'
import { addMembers, removeMember } from '@/features/chat/conversation-service'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({ userIds: z.array(z.string()).min(1).max(50) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { id } = await params
  const r = await addMembers({ conversationId: id, userIds: parsed.data.userIds, byId: user.id })
  if (!r.ok) return NextResponse.json({ error: r.message }, { status: 403 })
  const convo = await prisma.conversation.findUnique({ where: { id } })
  for (const uid of parsed.data.userIds) {
    await notify(uid, 'channel_added', { message: `${user.name} added you to #${convo?.name ?? 'a channel'}`, conversationId: id })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { id } = await params
  const r = await removeMember({ conversationId: id, userId: parsed.data.userId, byId: user.id })
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message }, { status: 403 })
}
