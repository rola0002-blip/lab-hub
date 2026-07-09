import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { accessibleConversationIds } from './conversation-service'

export type SearchHit = {
  id: string; conversationId: string; conversationName: string | null; conversationType: 'CHANNEL' | 'DM'
  authorName: string; body: string; createdAt: string; rank: number
}

export async function searchMessages(args: { userId: string; query: string; conversationId?: string; take?: number }): Promise<SearchHit[]> {
  const query = args.query.trim()
  if (!query) return []
  let ids = await accessibleConversationIds(args.userId)
  if (args.conversationId) ids = ids.filter((id) => id === args.conversationId)
  if (ids.length === 0) return []
  const take = Math.min(args.take ?? 25, 50)
  const rows = await prisma.$queryRaw<
    { id: string; conversationId: string; conversationName: string | null; conversationType: 'CHANNEL' | 'DM'; authorName: string; body: string; createdAt: Date; rank: number }[]
  >(Prisma.sql`
    SELECT m.id, m."conversationId",
           c.name AS "conversationName", c.type::text AS "conversationType",
           u.name AS "authorName", m.body, m."createdAt",
           ts_rank(m.search, websearch_to_tsquery('english', ${query}))::float AS rank
    FROM "Message" m
    JOIN "Conversation" c ON c.id = m."conversationId"
    JOIN "user" u ON u.id = m."userId"
    WHERE m.search @@ websearch_to_tsquery('english', ${query})
      AND m."deletedAt" IS NULL
      AND m."conversationId" IN (${Prisma.join(ids)})
    ORDER BY rank DESC, m."createdAt" DESC
    LIMIT ${take}
  `)
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
}
