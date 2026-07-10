import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { sendMessage } from '@/features/chat/message-service'

const body = z.object({
  conversationId: z.string().min(1),
  body: z.string().max(4000).default(''),
  parentId: z.string().optional(),
  broadcast: z.boolean().optional(),
  attachments: z.array(z.object({ path: z.string().startsWith('/uploads/chat/'), name: z.string().min(1), mime: z.string(), size: z.number().int().positive() })).max(10).optional(),
})

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const r = await sendMessage({ userId: user.id, ...parsed.data })
  if (r.ok) return NextResponse.json({ message: r.message }, { status: 201 })
  const status = r.error === 'forbidden' ? 403 : r.error === 'rate_limited' ? 429 : 422
  return NextResponse.json({ error: r.error, message: r.message }, { status })
}
