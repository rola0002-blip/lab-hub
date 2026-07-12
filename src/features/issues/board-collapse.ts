import type { IssueStatus } from '@prisma/client'
import { ISSUE_STATUSES } from './status'

// Board column collapse state, persisted per device in localStorage so it
// survives the keyed remounts IssuesSurface performs on every server-truth
// change (an SSE-driven refresh must not revert the user's expand/collapse).
// Kept pure (no React, no DOM) so it is unit-testable under node; the
// useSyncExternalStore wiring lives in board-view.tsx.
export const BOARD_COLLAPSE_KEY = 'colossus:issues:board-collapsed'

// Unset or unparseable → the default (Canceled collapsed). An explicit empty
// array is NOT the default: it means the user expanded every column, and that
// choice must persist. Unknown entries (stale/foreign values) are dropped.
export function parseCollapsed(raw: string | null): Set<IssueStatus> {
  if (raw !== null) {
    try {
      const arr: unknown = JSON.parse(raw)
      if (Array.isArray(arr)) return new Set(arr.filter((s): s is IssueStatus => (ISSUE_STATUSES as string[]).includes(s as string)))
    } catch { /* unparseable → default below */ }
  }
  return new Set<IssueStatus>(['CANCELED'])
}

export function serializeCollapsed(collapsed: ReadonlySet<IssueStatus>): string {
  return JSON.stringify([...collapsed])
}
