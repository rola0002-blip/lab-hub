import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { listPublicChannels } from '@/features/chat/conversation-service'

// Public channel directory for the browse dialog. listConversations only returns the
// caller's memberships, so browsing joinable channels needs this membership-agnostic list.
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return NextResponse.json({ channels: await listPublicChannels(user.id) })
}
