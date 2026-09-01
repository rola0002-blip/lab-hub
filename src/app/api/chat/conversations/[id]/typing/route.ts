import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { isMember } from '@/features/chat/conversation-service'
import { emitEvent } from '@/lib/events'
import { noteActivity } from '@/lib/activity'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!(await isMember(user.id, id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  noteActivity(user.id) // typing IS activity — feeds the push-idle gate
  await emitEvent({ t: 'typing', cid: id, uid: user.id, name: user.name })
  return NextResponse.json({ ok: true })
}
