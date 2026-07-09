import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { renameChannel, setChannelTopic } from '@/features/chat/conversation-service'

const schema = z
  .object({ name: z.string().min(1).max(60).optional(), topic: z.string().max(200).optional() })
  .refine((d) => d.name !== undefined || d.topic !== undefined, { message: 'nothing to update' })

// Rename a channel and/or set its topic. canManage-gated in the service; a
// permission/not-found failure is 403, a validation/uniqueness failure is 422.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { id } = await params

  if (parsed.data.name !== undefined) {
    const r = await renameChannel({ conversationId: id, name: parsed.data.name, byId: user.id })
    if (!r.ok) return NextResponse.json({ error: r.message }, { status: r.error === 'invalid' ? 422 : 403 })
  }
  if (parsed.data.topic !== undefined) {
    const r = await setChannelTopic({ conversationId: id, topic: parsed.data.topic, byId: user.id })
    if (!r.ok) return NextResponse.json({ error: r.message }, { status: r.error === 'invalid' ? 422 : 403 })
  }
  return NextResponse.json({ ok: true })
}
