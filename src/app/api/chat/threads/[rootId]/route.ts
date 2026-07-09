import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { listThread } from '@/features/chat/message-service'

export async function GET(_req: Request, { params }: { params: Promise<{ rootId: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { rootId } = await params
  const r = await listThread({ userId: user.id, rootId })
  if (!r.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return NextResponse.json({ root: r.root, replies: r.replies })
}
