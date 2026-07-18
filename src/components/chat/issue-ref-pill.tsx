'use client'
import Link from 'next/link'
import { STATUS_TOKEN, isDoneLike } from '@/features/issues/status'
import { ISSUE_PREFIX } from '@/features/issues/identifier'
import type { IssueStatus } from '@prisma/client'

// The subset of a resolved ref a pill renders. Keyed by number in the pane/detail
// Map; unresolved refs (absent from the Map) fall back to plain `LAB-<n>` text.
export type RefData = { identifier: string; title: string; status: IssueStatus }
export function IssueRefPill({ number, resolved }: { number: string; resolved?: RefData }) {
  const id = `${ISSUE_PREFIX}-${number}`
  if (!resolved) return <span className="text-default">{id}</span> // unresolvable → plain text
  const done = isDoneLike(resolved.status)
  return (
    <Link href={`/issues/${resolved.identifier}`} className="inline-flex items-center gap-1 rounded bg-accent-subtle px-1 align-baseline font-medium text-[var(--text-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]">
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: `var(${STATUS_TOKEN[resolved.status]})` }} />
      <span className="tabular-nums">{resolved.identifier}</span>
      <span className={done ? 'line-through opacity-70' : ''}>{resolved.title}</span>
    </Link>
  )
}
