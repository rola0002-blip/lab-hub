import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { searchIssues } from '@/features/issues/issue-search-service'
import { parseIdentifier, formatIdentifier } from '@/features/issues/identifier'
import { prisma } from '@/lib/db'

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = new URL(req.url).searchParams.get('q') ?? ''
  const n = parseIdentifier(q)
  if (n !== null) {
    const exists = await prisma.issue.findUnique({ where: { number: n }, select: { number: true } })
    if (exists) return NextResponse.json({ jump: `/issues/${formatIdentifier(exists.number)}`, hits: [] })
  }
  return NextResponse.json({ hits: await searchIssues({ query: q }) })
}
