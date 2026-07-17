import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { saveSubscription, deleteSubscription } from '@/lib/push'
import { isAllowedPushEndpoint } from '@/lib/push-endpoint'

const subBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
})

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = subBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  // Reject any endpoint that is not a known push service before storing it (SP7 F6): the stored
  // endpoint is later POSTed to server-side, so an internal/loopback/arbitrary URL would be a
  // member-triggerable blind SSRF sink.
  if (!isAllowedPushEndpoint(parsed.data.endpoint))
    return NextResponse.json({ error: 'invalid_endpoint' }, { status: 400 })
  await saveSubscription(user.id, parsed.data)
  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function DELETE(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({ endpoint: z.string().url() }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  await deleteSubscription(user.id, parsed.data.endpoint)
  return NextResponse.json({ ok: true })
}
