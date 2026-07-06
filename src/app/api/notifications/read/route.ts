import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/session'

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = z.object({ ids: z.array(z.string()).max(100) }).safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  await prisma.notification.updateMany({ where: { id: { in: body.data.ids }, userId: user.id }, data: { readAt: new Date() } })
  return NextResponse.json({ ok: true })
}
