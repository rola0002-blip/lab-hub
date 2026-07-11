import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser } from '@/lib/session'
import { moveIssue } from '@/features/issues/issue-service'
import { PolicyError, policyStatus } from '@/features/issues/issue-policy'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = z.object({
    status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED']),
    prevId: z.string().nullish(), nextId: z.string().nullish(),
  }).safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  const { id } = await params
  try {
    const issue = await moveIssue({ actorId: user.id, role: user.role, issueId: id, status: parsed.data.status, prevId: parsed.data.prevId ?? null, nextId: parsed.data.nextId ?? null })
    return NextResponse.json({ issue })
  } catch (e) {
    if (e instanceof PolicyError) return NextResponse.json({ error: e.message }, { status: policyStatus(e.code) })
    throw e
  }
}
