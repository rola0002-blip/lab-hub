import 'server-only'
import type { IssueStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { formatIdentifier, ISSUE_NUMBER_MAX } from './identifier'

// One row per resolvable COL-<n>. `number` keys the client-side Map; the rest is
// what the pill renders (identifier + live title + status → dot + strike-through).
export type ResolvedRef = { number: number; identifier: string; title: string; status: IssueStatus }

// Batched resolution: dedupe + validate the requested numbers, cap the fan-out at
// 100, and resolve them all in ONE query. Unresolvable numbers are simply absent
// from the result (the pill falls back to plain `COL-<n>` text).
export async function resolveIssueRefs(numbers: number[]): Promise<ResolvedRef[]> {
  // Bound to int4 max too: an oversized number reaching the Prisma Int predicate
  // would raise `22003 value out of range` → 500 on GET /api/issues/refs.
  const unique = [...new Set(numbers)].filter((n) => Number.isSafeInteger(n) && n > 0 && n <= ISSUE_NUMBER_MAX).slice(0, 100)
  if (unique.length === 0) return []
  const rows = await prisma.issue.findMany({ where: { number: { in: unique } }, select: { number: true, title: true, status: true } })
  return rows.map((r) => ({ number: r.number, identifier: formatIdentifier(r.number), title: r.title, status: r.status }))
}
