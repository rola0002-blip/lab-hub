import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { getIssue } from '@/features/issues/issue-service'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  const issue = await getIssue(id)
  if (!issue) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ issue })
}
