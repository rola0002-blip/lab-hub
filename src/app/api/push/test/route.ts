import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { sendPush } from '@/lib/push'

// Test ping for the "Get notified" wizard: sends one real web push to the
// CALLER's own subscriptions (never anyone else's). sendPush is a no-op
// when the caller has no subscriptions or VAPID is unconfigured — ok is
// still returned; the wizard's subscribed-state gating happens client-side.
export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await sendPush(user.id, {
    title: 'LabHub test notification',
    body: 'Notifications are working — you can dismiss this.',
    url: '/chat',
    tag: 'test',
  })
  return NextResponse.json({ ok: true })
}
