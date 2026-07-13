import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export type DocumentSearchHit = { id: string; name: string; path: string; mime: string }

export async function searchDocuments(args: { query: string; take?: number }): Promise<DocumentSearchHit[]> {
  const query = args.query.trim()
  if (!query) return []
  // Normalize dots/underscores/hyphens to spaces so filename component words
  // ("protocol", "CVD", "SOP") tokenize individually — the `english` parser lexes
  // `graphene-transfer-protocol.pdf` as ONE token otherwise. Mirrors the same
  // regexp_replace baked into the Document.search generated column (migration
  // 20260713000200) so a hyphenated query still matches the normalized column.
  const normalized = query.replace(/[._-]/g, ' ')
  const take = Math.min(args.take ?? 25, 50)
  return prisma.$queryRaw<DocumentSearchHit[]>(Prisma.sql`
    SELECT d.id, d.name, d.path, d.mime
    FROM "Document" d
    WHERE d.search @@ websearch_to_tsquery('english', ${normalized})
    ORDER BY ts_rank(d.search, websearch_to_tsquery('english', ${normalized})) DESC, d."createdAt" DESC
    LIMIT ${take}
  `)
}
