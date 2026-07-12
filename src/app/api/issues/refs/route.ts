import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { resolveIssueRefs } from '@/features/issues/issue-ref-service'

// Batched pill resolution for chat: `?n=1,2,3` → `{ refs: ResolvedRef[] }`. ANY
// authenticated user may resolve — issues are workspace-visible, so this route is
// deliberately NOT membership-gated (the deliberate asymmetry vs chat reads).
export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const raw = new URL(req.url).searchParams.get('n') ?? ''
  const numbers = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  return NextResponse.json({ refs: await resolveIssueRefs(numbers) })
}
