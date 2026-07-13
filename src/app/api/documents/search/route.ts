import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { searchDocuments } from '@/features/documents/document-search-service'

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = new URL(req.url).searchParams.get('q') ?? ''
  return NextResponse.json({ hits: await searchDocuments({ query: q }) })
}
