import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { listPinned } from '@/features/chat/message-service'

// W4-A1: the pinned list for the header popover. A dedicated route (not the
// message window) because pinned messages can be older than the loaded page —
// the popover needs them regardless of scroll position.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const messages = await listPinned({ conversationId: id, userId: user.id })
  if (messages === null) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ messages })
}
