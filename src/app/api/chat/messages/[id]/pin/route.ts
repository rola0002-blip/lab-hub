import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { setPinned } from '@/features/chat/message-service'

// W4-A1: pin/unpin a message. Members/admins only (setPinned rejects guests);
// body is the reactions-route zod idiom ({ pinned: boolean }).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({ pinned: z.boolean() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { id } = await params
  const r = await setPinned({ messageId: id, userId: user.id, role: user.role, pinned: parsed.data.pinned })
  if (r.ok) return NextResponse.json({ message: r.message })
  return NextResponse.json({ error: r.message }, { status: r.error === 'invalid' ? 400 : 403 })
}
