import 'server-only'
import { Prisma } from '@prisma/client'
import type { IssueStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { formatIdentifier } from './identifier'

export type IssueSearchHit = {
  id: string; number: number; identifier: string; title: string; status: IssueStatus; rank: number
}

export async function searchIssues(args: { query: string; take?: number }): Promise<IssueSearchHit[]> {
  const query = args.query.trim()
  if (!query) return []
  const take = Math.min(args.take ?? 25, 50)
  const rows = await prisma.$queryRaw<
    { id: string; number: number; title: string; status: IssueStatus; rank: number }[]
  >(Prisma.sql`
    SELECT i.id, i.number, i.title, i.status::text AS status,
           ts_rank(i.search, websearch_to_tsquery('english', ${query}))::float AS rank
    FROM "Issue" i
    WHERE i.search @@ websearch_to_tsquery('english', ${query})
    ORDER BY rank DESC, i."createdAt" DESC
    LIMIT ${take}
  `)
  return rows.map((r) => ({ ...r, identifier: formatIdentifier(r.number) }))
}
